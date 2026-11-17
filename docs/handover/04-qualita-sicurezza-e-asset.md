# 04 - Qualità, Sicurezza e Trasferimento Asset

**Progetto:** `app-calendario-palestra` (Calendario Palestra)  
**Destinatari:** Project Manager, Responsabile Qualità (QA), Ufficio Legale / Compliance, Cliente Committente  
**Ultimo aggiornamento:** 17/11/2026  
**Referente Project Management / Legal:** `[DA COMPLETARE: Nome e contatto del Project Manager / Referente Legale]`

---

## 1. Strategia e Report di Testing

Il repository include una suite completa di test automatizzati basata su **Vitest (`v5.1.0`)**, progettata per verificare in modo deterministico sia le funzioni pure di dominio sia gli endpoint API completi contro un database SQLite reale in-memory che emula l'interfaccia `D1Database` di Cloudflare ([tests/helpers/mock-d1.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/helpers/mock-d1.ts)).

### 1.1 Comandi di Esecuzione Test

```bash
# Esecuzione completa in modalità CI / singola passata
npm test
# oppure
npx vitest run
```

### 1.2 Report di Esecuzione Reale

All'atto della consegna, l'intera suite di test viene eseguita con esito **100% positivo (10 test suite superate su 10, 45 test superati su 45)**.

| File di Test | Tipologia | N. Test | Aree Funzionali e Tecniche Coperte | Stato |
| :--- | :--- | :---: | :--- | :---: |
| [tests/db-schema.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/db-schema.test.ts) | Integration (DB & Seed) | 5 | Verifica creazione delle 9 tabelle SQLite, vincoli `CHECK` (`not_empty`, colori corso, formato telefono `E.164`, step 5 minuti, ordine temporale), indici parziali univoci (`WHERE deleted_at IS NULL`) e idempotenza dello script di seed (`admin` invisibile, sede `Europe/Rome`, gerente). | PASS |
| [tests/timezone.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/timezone.test.ts) | Unit | 5 | Conversione DST-aware tra fuso IANA (`Europe/Rome`, `America/New_York`) e UTC ISO 8601 sia in ora solare (`+01:00`) sia in ora legale (`+02:00`), rifiuto degli orari inesistenti nel salto DST primaverile, generazione date ricorrenti a cavallo del cambio ora e formattazione `it-IT`. | PASS |
| [tests/schedule-status.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/schedule-status.test.ts) | Unit | 4 | Calcolo dinamico di `enrolled_count`, `remaining_spots` e di tutti gli 8 stati di `schedules.status` (`DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED_LOW_ENROLLMENT`, `CANCELLED_BY_PROVIDER`), inclusi i casi con campi minuti `NULL` e margine di 5 minuti. | PASS |
| [tests/subscription-entrances.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/subscription-entrances.test.ts) | Unit | 4 | Calcolo dinamico di `remaining_entrances` (esclusione lezioni annullate e code non promosse), verifica validità sottoscrizione e algoritmo di selezione automatica dell'abbonamento che scade prima (`selectBestUserSubscriptionForSchedule`). | PASS |
| [tests/schemas.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/schemas.test.ts) | Unit | 5 | Validazione schemi condivisi Zod 4 per autenticazione, corsi, lezioni ricorrenti, abbonamenti, sottoscrizioni (con guardie su data di scadenza ed entrate usate) e utenti. | PASS |
| [tests/auth.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/auth.test.ts) | Integration (API & Sicurezza) | 5 | Login multi-ruolo (`defaultMode` e `defaultRedirect`), flusso completo recupero password con token HMAC di 30 minuti e verifica monouso tramite `password_hash` tail, cambio sede attiva (`/api/settings/center`), cambio password (`/api/settings/password`) e middleware RBAC. | PASS |
| [tests/core-crud-apis.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/core-crud-apis.test.ts) | Integration (API & Email) | 3 | CRUD completo per `/api/classes`, `/api/subscriptions`, `/api/user-subscriptions` e `/api/users`; verifica blocchi `409 Conflict` su eliminazione/modifica e invio email transazionali nell'outbox. | PASS |
| [tests/schedules-and-summary.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/schedules-and-summary.test.ts) | Integration (API & Concorrenza) | 4 | Creazione atomica lezioni ricorrenti, filtro `DRAFT` per i clienti, blocchi di stato su modifica/annullamento lezione, iscrizione, inserimento in coda, promozione automatica del primo utente in coda alla disiscrizione, email agli iscritti e riepilogo `/api/customer/summary`. | PASS |
| [tests/worker-ui-formatters.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/worker-ui-formatters.test.ts) | Unit (UI Helpers) | 7 | Conversione ore/minuti, etichette offset temporali, stili badge dei 10 colori corso e degli 8 stati lezione, ed estrazione messaggi di errore API. | PASS |
| [tests/customer-and-e2e-flows.test.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/tests/customer-and-e2e-flows.test.ts) | End-to-End (API Flows & UI Helpers) | 3 | Verifica formattatori Card Corso a 4 righe, blocco navigazione giorni passati e flusso E2E completo: *Login -> Recupero Password -> Impostazioni -> Prenotazione & Coda -> Riepilogo Cliente -> Logout*. | PASS |

---

## 2. Sicurezza Implementata

### 2.1 Autenticazione e Crittografia (`server/utils/crypto.ts`, `server/utils/auth.ts`)
- **Hashing delle Password (PBKDF2-SHA256):**
  - Le password non vengono mai salvate in chiaro. L'applicazione utilizza l'API standard **Web Crypto (`crypto.subtle`)** con algoritmo `PBKDF2`, funzione di hash `SHA-256`, **100.000 iterazioni**, salt crittograficamente casuale a **16 byte** (`crypto.getRandomValues`) e chiave derivata a **256 bit**.
  - Formato salvato in `users.password_hash`: `pbkdf2_sha256$100000$<salt_hex>$<hash_hex>`.
  - La verifica in `verifyPassword()` utilizza un confronto **constant-time** (XOR bit a bit) per prevenire attacchi di tipo *timing side-channel*.
- **Gestione Sessione Stateless (`palestra_session`):**
  - La sessione è mantenuta in un cookie HTTP-only denominato `palestra_session` con durata massima di **400 giorni** (`SESSION_MAX_AGE_SECONDS = 34.560.000`).
  - Il token contiene il payload JSON `{ typ: "session", uid: userId, cid: centerId, iat: timestamp }` codificato in Base64URL e firmato con **HMAC-SHA256** tramite il segreto server `AUTH_SECRET`.
  - Attributi di sicurezza del cookie: `HttpOnly: true`, `SameSite: 'lax'`, `Path: '/'`, e `Secure: true` quando `NODE_ENV === 'production'`.
- **Recupero Password Stateless Monouso:**
  - L'endpoint `/api/auth/recover` non rivela se un indirizzo email esiste o meno nel sistema (prevenzione *user enumeration*), restituendo sempre un messaggio neutro.
  - Il token generato (`typ: "recovery"`) ha una validità rigorosa di **30 minuti** (`RECOVERY_TOKEN_TTL_MS`) e incorpora gli ultimi 8 caratteri dell'attuale `password_hash` dell'utente (`pht`).
  - Non appena l'utente reimposta la password su `/api/auth/reset-password`, il `password_hash` cambia e il token diventa immediatamente inutilizzabile per qualsiasi secondo tentativo.

### 2.2 Autorizzazione e Controllo Accessi Basato sui Ruoli (RBAC)
- **Verifica su Database a Ogni Richiesta (`authenticateRequest`):**
  - Anche con un cookie formalmente valido, il middleware [server/middleware/auth.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/server/middleware/auth.ts) interroga D1 a ogni chiamata API per verificare che:
    1. L'utente esista ancora e sia attivo (`users.deleted_at IS NULL`).
    2. La sede selezionata sia attiva (`centers.deleted_at IS NULL`).
    3. L'utente abbia un'appartenenza attiva in quella specifica sede (`users_centers.deleted_at IS NULL`).
  - Se un utente viene rimosso da una sede, l'accesso alle API di quella sede viene revocato istantaneamente (`403 Forbidden`).
- **Separazione dei Privilegi per Ruolo:**
  - `requireManager`: riservato esclusivamente al Gerente (`is_manager = true`), richiesto per creare o modificare il ruolo di Vice Gerente.
  - `requireManagerOrAssistant`: riservato a Gerente e Vice Gerente per tutte le operazioni di scrittura (`POST`, `PUT`, `DELETE`) su corsi, lezioni, abbonamenti, sottoscrizioni e utenti.
  - `requireWorker`: consente l'accesso in lettura anche agli Istruttori (`is_instructor = true`), bloccando i semplici Clienti.
  - **Isolamento Multi-Centro (`center_id`):** ogni query SQL filtra sistematicamente per `auth.centerId`, impedendo qualsiasi accesso orizzontale (IDOR) a corsi, lezioni, abbonamenti o utenti appartenenti ad altre sedi.

### 2.3 Validazione Input e Protezione Dati
- **Doppia Validazione (Client + Server) con Zod 4:** tutti i payload JSON in ingresso vengono validati tramite `readValidatedBodyWithZod()` e tutti i parametri UUID nelle URL tramite `requireUuidParam()`.
- **Prevenzione SQL Injection:** tutte le query utilizzano i parametri vincolati (bound parameters) generati da **Drizzle ORM**; non viene mai concatenato input utente grezzo nelle query SQL.
- **Prevenzione XSS nelle Email HTML:** tutti i dati dinamici inseriti nei template HTML delle email (`server/utils/email.ts`) vengono sanitizzati tramite la funzione `escapeHtml()`.
- **Audit Trail e Conservazione Dati:** nessuna riga viene mai cancellata fisicamente dal database; ogni modifica registra l'autore in `updated_by` e il timestamp in `updated_at`.

---

## 3. Inventario Dipendenze (SBOM - Software Bill of Materials)

I dati seguenti sono estratti direttamente dai file manifest [package.json](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/package.json) e `package-lock.json` presenti nel repository. Tutte le dipendenze utilizzano licenze open-source permissive (**MIT** e **Apache-2.0**) compatibili con l'uso commerciale e proprietario.

### 3.1 Dipendenze di Produzione (`dependencies`)

| Pacchetto npm | Versione Dichiarata | Versione Risolta (`lockfile`) | Licenza Open-Source | Scopo Principale |
| :--- | :--- | :--- | :--- | :--- |
| `nuxt` | `^4.6.4` | `4.6.4` | `MIT` | Framework full-stack Vue 3 + Nitro Server |
| `vue` | `^3.5.45` | `3.5.45` | `MIT` | Libreria reattiva per l'interfaccia utente |
| `vue-router` | `^5.4.0` | `5.5.0` | `MIT` | Gestione del routing client/SSR |
| `drizzle-orm` | `^0.45.4` | `0.45.4` | `Apache-2.0` | ORM TypeScript per database SQLite / Cloudflare D1 |
| `zod` | `^4.6.7` | `4.6.7` | `MIT` | Validazione schemi dati condivisi frontend/backend |
| `uuidv7` | `^1.2.1` | `1.2.1` | `Apache-2.0` | Generatore di identificativi univoci UUIDv7 (`CHAR(36)`) |

### 3.2 Dipendenze di Sviluppo, Build e Test (`devDependencies`)

| Pacchetto npm | Versione Dichiarata | Versione Risolta (`lockfile`) | Licenza Open-Source | Scopo Principale |
| :--- | :--- | :--- | :--- | :--- |
| `@cloudflare/workers-types` | `^5.20261112.1` | `5.20261112.1` | `MIT OR Apache-2.0` | Definizioni TypeScript per il runtime Cloudflare Workers e D1 |
| `@nuxtjs/tailwindcss` | `^6.14.0` | `6.14.0` | `MIT` | Integrazione Tailwind CSS per Nuxt |
| `drizzle-kit` | `^0.31.11` | `0.31.11` | `MIT` | CLI per generazione migrazioni SQLite da `schema.ts` |
| `vitest` | `^5.1.0` | `5.1.0` | `MIT` | Test runner per test unitari, d'integrazione ed E2E |
| `wrangler` | `^4.160.1` | `4.160.1` | `MIT OR Apache-2.0` | CLI ufficiale Cloudflare per gestione D1, sviluppo locale e deploy |

---

## 4. Checklist di Trasferimento Asset (Handover Formale)

La tabella seguente deve essere compilata e verificata congiuntamente dal Fornitore e dal Cliente prima della firma del verbale di consegna definitiva.

| Categoria Asset | Identificativo / Risorsa | Intestatario / Account Destinazione | Stato Trasferimento | Note / Riferimenti |
| :--- | :--- | :--- | :---: | :--- |
| **Repository Codice Sorgente** | `[DA COMPLETARE: URL Repository Git (GitHub / GitLab / Bitbucket)]` | `[DA COMPLETARE: Organizzazione o Account Git del Cliente]` | `[ ] Da trasferire`<br>`[ ] Completato` | Verifica accesso branch principale e storico commit. |
| **Account Cloud & Edge** | Account Cloudflare (Workers & D1)<br>Worker: `app-calendario-palestra` | `[DA COMPLETARE: Email/ID Account Cloudflare del Cliente]` | `[ ] Da trasferire`<br>`[ ] Completato` | Verifica piano attivo e metodo di fatturazione intestato al Cliente. |
| **Database di Produzione** | Cloudflare D1: `app-calendario-palestra-db`<br>ID: `[DA COMPLETARE: UUID database_id di produzione]` | `[DA COMPLETARE: Account Cloudflare del Cliente]` | `[ ] Da trasferire`<br>`[ ] Completato` | Verifica applicazione migrazioni e sostituzione password di seed. |
| **Dominio Pubblico (.com)** | `[DA COMPLETARE: Nome a dominio .com del Cliente]` | `[DA COMPLETARE: Registrar e intestatario legale del dominio]` | `[ ] Da trasferire`<br>`[ ] Completato` | Necessario per il routing del Worker e per l'autenticazione email. |
| **Certificato SSL / TLS** | Certificato Edge SSL gestito da Cloudflare sul dominio pubblico | `[DA COMPLETARE: Account Cloudflare del Cliente]` | `[ ] Da trasferire`<br>`[ ] Completato` | Verifica HTTPS attivo e rinnovo automatico. |
| **Servizio Email Transazionale** | Account **Resend** oppure **Brevo**<br>Mittente: `[DA COMPLETARE: Indirizzo EMAIL_FROM]` | `[DA COMPLETARE: Account Resend/Brevo del Cliente]` | `[ ] Da trasferire`<br>`[ ] Completato` | Verifica stato `Verified` dei record DNS **SPF**, **DKIM** e **DMARC** sul dominio `.com`. |
| **Segreti di Produzione** | `AUTH_SECRET` e `RESEND_API_KEY` / `BREVO_API_KEY` configurati su Cloudflare Workers | `[DA COMPLETARE: Custode credenziali / Password Manager del Cliente]` | `[ ] Da trasferire`<br>`[ ] Completato` | Rigenerare `AUTH_SECRET` al momento del passaggio di consegne definitivo. |

---

### Firme di Accettazione Consegna

| Ruolo | Nome e Cognome / Ragione Sociale | Data | Firma |
| :--- | :--- | :--- | :--- |
| **Per il Fornitore (Consegna Tecnica)** | `[DA COMPLETARE: Nome e Cognome / Ragione Sociale Fornitore]` | `[DA COMPLETARE: Data]` | ___________________________ |
| **Per il Cliente (Accettazione)** | `[DA COMPLETARE: Nome e Cognome / Legale Rappresentante Cliente]` | `[DA COMPLETARE: Data]` | ___________________________ |
