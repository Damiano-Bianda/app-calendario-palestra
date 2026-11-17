# Piano di Test Manuale End-to-End (UAT & Edge Cases)

**Progetto**: App Calendario Palestra  
**Stack Tecnologico**: Nuxt 4 (Vue 3 Composition API, Nitro Server Routes), Tailwind CSS, Cloudflare Workers + D1 (SQLite), Drizzle ORM, Zod, Web Crypto API (PBKDF2-SHA256 + HMAC-SHA256)  
**Fonte di Verità**: `SPECIFICATION.md` e `GEMINI.md`  
**Lingua Interfaccia e Comunicazioni**: Italiano (`it-IT`)

---

## Indice

1. [Setup Ambiente, Seed e Prerequisiti](#1-setup-ambiente-seed-e-prerequisiti)
2. [Autenticazione, Sessione, Recupero Password Stateless e Impostazioni (`/login`, `/recover`, `/settings`)](#2-autenticazione-sessione-recupero-password-stateless-e-impostazioni-login-recover-settings)
3. [Navigazione, Layout Responsive e Permessi Ruolo (Worker vs Customer)](#3-navigazione-layout-responsive-e-permessi-ruolo-worker-vs-customer)
4. [Gestione Utenti e Multi-Sede (`/worker/users`)](#4-gestione-utenti-e-multi-sede-workerusers)
5. [Gestione Corsi (`/worker/classes`)](#5-gestione-corsi-workerclasses)
6. [Gestione Abbonamenti e Sottoscrizioni (`/worker/subscriptions` e `/worker/user-subscriptions`)](#6-gestione-abbonamenti-e-sottoscrizioni-workersubscriptions-e-workeruser-subscriptions)
7. [Calendario, Creazione Ricorrente e gli 8 Stati della Lezione (`/worker/calendar` e `/worker/schedules`)](#7-calendario-creazione-ricorrente-e-gli-8-stati-della-lezione-workercalendar-e-workerschedules)
8. [Iscrizioni, Code, Promozione Automatica e Conteggio Entrate (`/customer` e `/customer/summary`)](#8-iscrizioni-code-promozione-automatica-e-conteggio-entrate-customer-e-customersummary)
9. [Fusi Orari (IANA Timezone) e Ora Legale (DST)](#9-fusi-orari-iana-timezone-e-ora-legale-dst)
10. [Validazione Input (Zod Frontend + Backend) e Concorrenza](#10-validazione-input-zod-frontend--backend-e-concorrenza)
11. [Tabella di Sign-off Finale](#11-tabella-di-sign-off-finale)

---

## 1. Setup Ambiente, Seed e Prerequisiti

### 1.0 Reset Completo dell'Applicazione (Pulizia Totale prima del Test)

Se l'ambiente locale è già stato utilizzato in sessioni precedenti e si desidera **ripartire completamente da zero** (database D1 vergine, cache Nuxt/Nitro pulita e nessuna sessione residua nel browser), eseguire questa procedura prima del punto `1.1`:

1. **Fermare il server di sviluppo**:
   - Se `npm run dev` è attivo nel terminale, interromperlo con `Ctrl + C` (su Windows questo rilascia il lock sui file SQLite dentro `.wrangler/state/v3`).

2. **Eliminare il database D1 locale e le directory di cache/build**:
   - **Su Windows (PowerShell)**:
     ```powershell
     # Rimuove lo stato locale di Cloudflare D1 (.wrangler) e la cache di Nuxt (.nuxt, .output)
     Remove-Item -Recurse -Force .wrangler, .nuxt, .output -ErrorAction SilentlyContinue

     # Rigenera i tipi e la configurazione base di Nuxt
     npx nuxt prepare
     ```
   - **Su macOS / Linux (Bash / Zsh)**:
     ```bash
     rm -rf .wrangler .nuxt .output
     npx nuxt prepare
     ```
   - *(Alternativa SQL senza eliminare `.wrangler`: svuotamento di tutte le tabelle mantenendo lo schema)*:
     ```powershell
     npx wrangler d1 execute app-calendario-palestra-db --local --command "PRAGMA foreign_keys = OFF; DELETE FROM user_schedules; DELETE FROM users_subscriptions; DELETE FROM subscriptions_classes; DELETE FROM subscriptions; DELETE FROM schedules; DELETE FROM classes; DELETE FROM users_centers; DELETE FROM centers; DELETE FROM users; PRAGMA foreign_keys = ON;"
     ```

3. **Pulire il cookie di sessione nel Browser**:
   - Poiché il cookie `palestra_session` è `HttpOnly` e ha durata 400 giorni, dopo un reset del DB conterrebbe `userId` e `centerId` non più esistenti.
   - Aprire Chrome DevTools (`F12`) su `http://localhost:3000` -> scheda **Application** -> **Storage** -> cliccare **Clear site data** (oppure **Cookies** -> `http://localhost:3000` -> eliminare `palestra_session`).

---

### 1.1 Comandi di Avvio Database D1 Locale, Migrazioni, Seed e Server Nuxt

Dopo aver eseguito il reset (o al primo avvio), eseguire nell'ordine i seguenti comandi dalla root del progetto:

```powershell
# 1. Installazione dipendenze (e nuxt prepare automatico)
npm install

# 2. Applicazione migrazioni Drizzle su Cloudflare D1 locale (.wrangler/state/v3)
npm run db:migrate:local

# 3. Esecuzione del seed iniziale (Admin + Sede A "Palestra Centrale" + Gerente Sede A)
npm run db:seed:local

# 4. (Opzionale) Creazione della Sede B ("Palestra New York", timezone "America/New_York") e relativo Gerente per testare il Multi-Sede e i fusi orari
$env:SEED_CENTER_NAME="Palestra New York"; $env:SEED_MANAGER_EMAIL="gerente.ny@palestra.it"; npm run db:seed:local
Remove-Item Env:\SEED_CENTER_NAME, Env:\SEED_MANAGER_EMAIL -ErrorAction SilentlyContinue

# 5. Avvio del server di sviluppo Nuxt 4 (con binding Cloudflare D1 locale in .wrangler/state/v3)
npm run dev
```

L'applicazione sarà raggiungibile all'indirizzo: `http://localhost:3000`.

Per ispezionare in qualsiasi momento lo stato del database SQLite locale (D1) da terminale durante l'esecuzione dei test:

```powershell
npx wrangler d1 execute app-calendario-palestra-db --local --command "SELECT id, email, deleted_at FROM users;"
```

---

### 1.2 Credenziali degli Account di Test

| Ruolo / Profilo | Sede | Nome e Cognome | Email | Password Iniziale | Telefono (E.164) | Origine |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin (Invisibile)** | Nessuna (`users` puro) | — | `admin@palestra.it` | `Admin123!` | — | Creato da `npm run db:seed:local` |
| **Gerente Sede A** | Palestra Centrale (`Europe/Rome`) | Mario Rossi | `gerente@palestra.it` | `Gerente123!` | `+393330000000` | Creato da `npm run db:seed:local` |
| **Gerente Sede B** | Palestra New York (`America/New_York`) | Mario Rossi | `gerente.ny@palestra.it` | `Gerente123!` | `+393330000000` | Creato da seed Sede B (o SQL sotto) |
| **Vice Gerente** | Palestra Centrale (`Europe/Rome`) | Giulia Bianchi | `vice@palestra.it` | *(Generata via email console al test TC-015, poi impostata a `Vice1234!`)* | `+393331111111` | Creato via UI in `/worker/users/new` |
| **Istruttore** | Palestra Centrale (`Europe/Rome`) | Luca Verdi | `istruttore@palestra.it` | *(Generata via email console, poi impostata a `Istruttore1!`)* | `+393332222222` | Creato via UI in `/worker/users/new` |
| **Cliente 1** | Palestra Centrale (`Europe/Rome`) | Sara Neri | `cliente1@palestra.it` | *(Generata via email console, poi impostata a `Cliente1!`)* | `+393333333331` | Creato via UI in `/worker/users/new` |
| **Cliente 2 (Coda)** | Palestra Centrale (`Europe/Rome`) | Marco Gialli | `cliente2@palestra.it` | *(Generata via email console, poi impostata a `Cliente2!`)* | `+393333333332` | Creato via UI in `/worker/users/new` |

> **Nota per la creazione della Sede B con Timezone differente (`America/New_York`)**:  
> Poiché `server/db/seed.ts` utilizza `Europe/Rome` di default, per avere la **Sede B** con fuso orario `America/New_York` (utile per testare sia il cambio sede sia i fusi orari IANA differenti), eseguire questo comando D1 locale dopo `npm run db:seed:local`:
> ```powershell
> npx wrangler d1 execute app-calendario-palestra-db --local --command "INSERT INTO centers (id, name, timezone, created_by, updated_by, created_at, updated_at, deleted_at) SELECT '01930000-0000-7000-8000-000000000099', 'Palestra New York', 'America/New_York', id, id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL FROM users WHERE email = 'admin@palestra.it' AND deleted_at IS NULL;"
> ```
> E per abilitare il Gerente `gerente@palestra.it` anche sulla Sede B (`Palestra New York`):
> ```powershell
> npx wrangler d1 execute app-calendario-palestra-db --local --command "INSERT INTO users_centers (id, center_id, user_id, name, surname, phone_number, is_manager, is_assistant_manager, is_instructor, created_by, updated_by, created_at, updated_at, deleted_at) SELECT '01930000-0000-7000-8000-000000000098', '01930000-0000-7000-8000-000000000099', u.id, 'Mario', 'Rossi', '+393330000000', 1, 0, 0, a.id, a.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL FROM users u, users a WHERE u.email = 'gerente@palestra.it' AND a.email = 'admin@palestra.it';"
> ```

---

### 1.3 Verifica delle Email Transazionali in Locale

Il servizio email (`server/utils/email.ts`) supporta due modalità operative:
1. **Fallback automatico su Console di Sviluppo (Default in locale)**:
   - Quando le variabili d'ambiente `RESEND_API_KEY` e `BREVO_API_KEY` **non sono valorizzate**, ogni email transazionale viene stampata in tempo reale nel terminale in cui gira `npm run dev` con il prefisso:
     ```text
     [Email Dev Console] To: <destinatari> | Subject: <oggetto>
     <corpo testuale in italiano (inclusi password temporanee e link /recover?token=...)>
     ```
2. **Invio Reale tramite Resend o Brevo**:
   - Impostando `RESEND_API_KEY` (oppure `BREVO_API_KEY`) e opzionalmente `EMAIL_FROM="Palestra <noreply@tuodominio.com>"` e `APP_URL="http://localhost:3000"`, il backend invia le email tramite le API HTTP di Resend (`https://api.resend.com/emails`) o Brevo (`https://api.brevo.com/v3/smtp/email`).

---

## 2. Autenticazione, Sessione, Recupero Password Stateless e Impostazioni (`/login`, `/recover`, `/settings`)

### TC-001: Login Gerente e Redirect automatico a `/worker`
- [ ] **Stato esecuzione**
- **Precondizioni**: Database migrato e popolato con `npm run db:seed:local`. Nessuna sessione attiva nel browser (cookie `palestra_session` assente).
- **Passi operativi**:
  1. Aprire il browser su `http://localhost:3000/login`.
  2. Nel campo **Indirizzo email \*** (`#login-email`) inserire `gerente@palestra.it`.
  3. Nel campo **Password \*** (`#login-password`) inserire `Gerente123!`.
  4. Cliccare sul pulsante **Accedi** (`[data-testid="login-submit-btn"]`).
- **Risultato atteso**:
  - **UI**: L'utente viene reindirizzato automaticamente a `/worker` (**Dashboard Lavoratore**), dove sono visibili i 4 grandi pulsanti (**Crea corso**, **Crea lezione**, **Crea abbonamento**, **Crea cliente**) e l'indicazione `Sede attiva: Palestra Centrale (Europe/Rome)`.
  - **Cookie / Sessione**: Viene impostato il cookie HTTP-only `palestra_session` con `SameSite=Lax`, `Path=/`, `Max-Age=34560000` (400 giorni).
  - **DB**: Nessuna modifica su `users`; la lettura filtra `deleted_at IS NULL`.

---

### TC-002: Login Vice Gerente, Istruttore e Cliente (Redirect specifici per ruolo)
- [ ] **Stato esecuzione**
- **Precondizioni**: Account `vice@palestra.it` (`is_assistant_manager = 1`), `istruttore@palestra.it` (`is_instructor = 1`) e `cliente1@palestra.it` (nessun flag lavoratore) creati nella sede attiva (vedere sezione 4 o pre-creazione da Gerente).
- **Passi operativi**:
  1. Effettuare il login da `/login` con `vice@palestra.it` e la relativa password. Osservare l'URL di atterraggio e poi fare **Logout**.
  2. Effettuare il login da `/login` con `istruttore@palestra.it` e la relativa password. Osservare l'URL di atterraggio e poi fare **Logout**.
  3. Effettuare il login da `/login` con `cliente1@palestra.it` e la relativa password. Osservare l'URL di atterraggio.
- **Risultato atteso**:
  - **UI (Vice Gerente)**: Atterra su `/worker` in modalità `Lavoratore`, con badge ruolo `Vice gerente`.
  - **UI (Istruttore)**: Atterra direttamente su `/worker/calendar` in modalità `Lavoratore`, con badge `Istruttore` e badge giallo `Sola lettura`.
  - **UI (Cliente)**: Atterra direttamente su `/customer` (**Lezioni del giorno**) in modalità `Cliente`, posizionato sulla data odierna della sede.

---

### TC-003: Blocco Login per utente `admin` (Invisibile e senza sede associata) e Credenziali Errate
- [ ] **Stato esecuzione**
- **Precondizioni**: Utente `admin@palestra.it` presente in `users` ma privo di righe in `users_centers`.
- **Passi operativi**:
  1. Su `/login`, inserire `gerente@palestra.it` e password errata `PasswordSbagliata1!` -> cliccare **Accedi**.
  2. Su `/login`, inserire `admin@palestra.it` e password `Admin123!` -> cliccare **Accedi**.
- **Risultato atteso**:
  - **UI (Passo 1)**: Compare il banner rosso `[data-testid="login-error"]` con messaggio `Credenziali non valide.` (HTTP `401`).
  - **UI (Passo 2)**: Compare il banner rosso `[data-testid="login-error"]` con messaggio `Nessuna sede attiva associata a questo account.` (HTTP `403`). L'utente `admin` non può entrare nell'interfaccia applicativa.

---

### TC-004: Recupero Password Stateless — Richiesta con Email Esistente vs Email Inesistente
- [ ] **Stato esecuzione**
- **Precondizioni**: Utente `gerente@palestra.it` attivo nel DB.
- **Passi operativi**:
  1. Dalla pagina `/login`, cliccare su **Password dimenticata? Recupera password** (`[data-testid="forgot-password-link"]`) per aprire `/recover`.
  2. Inserire un'email **inesistente**: `inesistente@palestra.it` nel campo `#recover-email` e cliccare **Invia link di recupero** (`[data-testid="recover-submit-btn"]`).
  3. Controllare il terminale del server Nuxt.
  4. Inserire ora l'email **esistente**: `gerente@palestra.it` e cliccare **Invia link di recupero**.
  5. Controllare il terminale del server Nuxt.
- **Risultato atteso**:
  - **UI (Passi 2 e 4)**: In entrambi i casi compare il banner verde `[data-testid="recover-success"]` con il medesimo messaggio anti-enumerazione: `Se l'indirizzo email è associato a un account attivo, riceverai un link per reimpostare la password.` (HTTP `200`).
  - **Email / Console (Passo 3 - Email inesistente)**: Nessuna email generata nel terminale.
  - **Email / Console (Passo 5 - Email esistente)**: Nel terminale compare:
    ```text
    [Email Dev Console] To: gerente@palestra.it | Subject: Recupero password - Calendario Palestra
    ...
    http://localhost:3000/recover?token=<payloadB64>.<signatureB64>
    ```

---

### TC-005: Recupero Password Stateless — Utilizzo Valido del Link entro 30 Minuti
- [ ] **Stato esecuzione**
- **Precondizioni**: Aver eseguito `TC-004` ed estratto dal terminale il link `http://localhost:3000/recover?token=...` generato da meno di 30 minuti.
- **Passi operativi**:
  1. Aprire nel browser il link completo `http://localhost:3000/recover?token=...`.
  2. Verificare che il titolo della pagina cambi in **Imposta nuova password**.
  3. Test di non corrispondenza: inserire `NuovaPass123!` in **Nuova password \*** (`#new-password`) e `Diversa123!` in **Conferma nuova password \*** (`#confirm-password`), poi cliccare **Salva nuova password** (`[data-testid="reset-submit-btn"]`).
  4. Inserire `NuovaGerente123!` in entrambi i campi `#new-password` e `#confirm-password` e cliccare **Salva nuova password**.
  5. Cliccare su **Vai al Login** e accedere con `gerente@palestra.it` e `NuovaGerente123!`.
- **Risultato atteso**:
  - **UI (Passo 3)**: Banner di errore `[data-testid="reset-error"]` con testo `Le password non coincidono.`.
  - **UI (Passo 4)**: Banner verde `[data-testid="reset-success"]` con testo `Password aggiornata con successo.` e pulsante **Vai al Login**.
  - **DB**: Nella tabella `users`, `password_hash` e `updated_at` dell'utente `gerente@palestra.it` sono stati aggiornati; `updated_by` è valorizzato con l'`id` dell'utente stesso.
  - **UI (Passo 5)**: Il login con la vecchia password `Gerente123!` fallisce (`401`), mentre con `NuovaGerente123!` riesce.

---

### TC-006: Recupero Password Stateless — Edge Case 1 (Monouso Immediato / Riuso dello Stesso Link)
- [ ] **Stato esecuzione**
- **Precondizioni**: Aver appena completato il cambio password in `TC-005` usando il link `/recover?token=...`.
- **Passi operativi**:
  1. Riaprire nel browser **lo stesso identico link** `http://localhost:3000/recover?token=...` utilizzato in `TC-005` (ancora dentro la finestra temporale dei 30 minuti).
  2. Inserire `AltraPassword123!` in `#new-password` e `#confirm-password`.
  3. Cliccare **Salva nuova password** (`[data-testid="reset-submit-btn"]`).
- **Risultato atteso**:
  - **UI**: L'operazione viene bloccata e compare il banner di errore `[data-testid="reset-error"]` con il messaggio esatto: `Token di recupero già utilizzato o non più valido.` (HTTP `400`).
  - **Logica / DB**: Poiché il payload stateless del token contiene il claim `pht` (ultimi 8 caratteri del precedente `password_hash`), e `password_hash` in `users` è cambiato al passo `TC-005`, il confronto `getPasswordHashTail(user.passwordHash) !== payload.passwordHashTail` invalida istantaneamente il token senza bisogno di tabelle DB per i token.

---

### TC-007: Recupero Password Stateless — Edge Case 2 (Token Manipolato o Scaduto > 30 Minuti)
- [ ] **Stato esecuzione**
- **Precondizioni**: Disporre di un link `/recover?token=<payloadB64>.<signatureB64>`.
- **Passi operativi**:
  1. **Token manipolato nella firma o nel payload**: aprire `/recover?token=<payloadB64>.firmaManomessa123`, inserire `PasswordValida123!` in entrambi i campi e cliccare **Salva nuova password**.
  2. **Token scaduto (> 30 minuti)**: generare un token con scadenza passata (oppure attendere > 30 minuti / decodificare il payload e osservare che cambiando `exp` senza chiave segreta HMAC fallisce, oppure in ambiente di test avanzare l'orologio di sistema di 31 minuti) e inviare il form.
- **Risultato atteso**:
  - **UI**: In entrambi i casi compare il banner rosso `[data-testid="reset-error"]` con messaggio: `Token di recupero non valido o scaduto.` (HTTP `400`) e il link `Richiedi un nuovo link di recupero`.
  - **DB**: Nessuna modifica a `users.password_hash`.

---

### TC-008: Impostazioni (`/settings`) — Cambio Password Personale, Cambio Sede Attiva e Logout
- [ ] **Stato esecuzione**
- **Precondizioni**: Utente `gerente@palestra.it` autenticato e abilitato sia su **Palestra Centrale** (`Europe/Rome`) sia su **Palestra New York** (`America/New_York`) come da Setup 1.2.
- **Passi operativi**:
  1. Navigare su `/settings`. Verificare nella card **Profilo attuale** i dati: Nome e cognome (`Mario Rossi`), Email (`gerente@palestra.it`), Ruolo (`Gerente`), Fuso orario sede (`Europe/Rome`).
  2. **Cambio Password con password attuale errata**: nella sezione **Cambio password**, inserire `PasswordSbagliata!` in **Password attuale \*** (`#current-password`), `Gerente123!` in **Nuova password \*** (`#settings-new-password`) e `Gerente123!` in **Conferma nuova password \*** (`#settings-confirm-password`). Cliccare **Aggiorna password** (`[data-testid="settings-password-submit"]`).
  3. **Cambio Password valido**: inserire la password attuale corretta (`NuovaGerente123!`), e come nuova password e conferma inserire `Gerente123!`. Cliccare **Aggiorna password**.
  4. **Cambio Sede Attiva (`PUT /api/settings/center`)**: nella sezione **Cambio centro**, aprire la tendina **Sede attiva** (`[data-testid="settings-center-select"]`), selezionare `Palestra New York (America/New_York)` e cliccare **Cambia sede** (`[data-testid="settings-center-submit"]`).
  5. Riportare la sede attiva su `Palestra Centrale (Europe/Rome)` e cliccare **Cambia sede**.
  6. **Logout**: nella sezione **Disconnessione**, cliccare il pulsante rosso **Logout** (`[data-testid="settings-logout-btn"]`). Tentare poi di navigare manualmente su `/worker`.
- **Risultato atteso**:
  - **UI (Passo 2)**: Banner rosso `La password attuale non è corretta.` (HTTP `400`).
  - **UI + DB (Passo 3)**: Banner verde `Password modificata con successo.` e `users.password_hash` aggiornato nel DB.
  - **UI + Sessione (Passo 4)**: Banner verde `Sede attiva aggiornata a "Palestra New York".`, la card **Profilo attuale** aggiorna immediatamente `Fuso orario sede: America/New_York` e la sidebar mostra `Palestra New York`. Il cookie `palestra_session` viene riassegnato con il nuovo `centerId`.
  - **UI + Sessione (Passo 6)**: Il cookie `palestra_session` viene cancellato; l'utente viene portato su `/login` e il tentativo di accesso a `/worker` reindirizza forzatamente a `/login`.

---

## 3. Navigazione, Layout Responsive e Permessi Ruolo (Worker vs Customer)

### TC-009: Navbar Responsive Desktop vs Mobile
- [ ] **Stato esecuzione**
- **Precondizioni**: Utente `gerente@palestra.it` autenticato su `/worker`.
- **Passi operativi**:
  1. Con finestra browser **Desktop** (`>= 768px`, breakpoint `md`): osservare la disposizione della barra di navigazione e del pulsante cambio modalità.
  2. Ridimensionare la finestra o aprire il **Device Toolbar di Chrome DevTools** in modalità **Mobile** (es. iPhone 14 / Pixel 7, larghezza `390px`): osservare la barra superiore e la barra inferiore.
- **Risultato atteso**:
  - **UI Desktop**: Navbar **verticale fissa sul lato sinistro** (`aside`) contenente: nome sede, nome utente, badge ruolo, pulsante toggle `[data-testid="desktop-mode-toggle"]` (`Modalità Lavoratore` / `Passa a Cliente ⇄`), i link di navigazione (`Dashboard`, `Calendario`, `Clienti`, `Corsi`, `Lezioni`, `Abbonamenti`, `Sottoscrizioni`, `Impostazioni`) e in fondo il pulsante `Logout` (`[data-testid="desktop-logout-btn"]`).
  - **UI Mobile**:
    - Header fisso in alto con nome sede a sinistra e **toggle button cambio modalità in alto a destra** (`[data-testid="mobile-mode-toggle"]`: `Modalità: Lavoratore ⇄ Cliente`).
    - Navbar **orizzontale fissa in fondo allo schermo** (`nav.fixed.bottom-0`) con tutte le voci di navigazione e il bottone `Logout` (`[data-testid="mobile-logout-btn"]`).

---

### TC-010: Toggle Lavoratore / Cliente (Visibile per Lavoratori, Assente per Clienti puri)
- [ ] **Stato esecuzione**
- **Precondizioni**: Disporre di un account Lavoratore (`gerente@palestra.it` o `istruttore@palestra.it`) e di un account Cliente puro (`cliente1@palestra.it`).
- **Passi operativi**:
  1. Loggarsi come `gerente@palestra.it` (atterra su `/worker`). Cliccare sul toggle **Passa a Cliente ⇄** (`[data-testid="desktop-mode-toggle"]` su desktop o `[data-testid="mobile-mode-toggle"]` su mobile).
  2. Verificare il layout su `/customer` e cliccare sul toggle **Passa a Lavoratore ⇄** (`[data-testid="desktop-customer-mode-toggle"]` o `[data-testid="mobile-customer-mode-toggle"]`).
  3. Effettuare il logout e loggarsi come **Cliente puro** (`cliente1@palestra.it`). Ispezionare la sidebar desktop, l'header mobile e la pagina `/settings`.
  4. Da Cliente puro, digitare manualmente nella barra indirizzi `http://localhost:3000/worker` o `http://localhost:3000/worker/classes`.
- **Risultato atteso**:
  - **UI (Passi 1-2)**: Il Gerente passa fluidamente da `/worker` a `/customer` (con le voci `Lezioni`, `Riepilogo`, `Impostazioni`) e torna a `/worker` (per l'Istruttore il ritorno porta a `/worker/calendar`).
  - **UI (Passo 3 - Cliente puro)**: Il pulsante toggle `Modalità Cliente ⇄ Lavoratore` **NON è presente** né su desktop né nell'header in alto a destra su mobile.
  - **Sicurezza / Middleware (Passo 4)**: Il middleware client `app/middleware/worker.ts` intercetta l'accesso non autorizzato e reindirizza immediatamente il Cliente puro a `/customer`. Qualsiasi chiamata API diretta a endpoint riservati ai lavoratori (es. `GET /api/users`) restituisce HTTP `403` (`Permessi insufficienti: accesso riservato ai lavoratori della sede.`).

---

### TC-011: Guardia Istruttore — Assenza Dashboard (`/worker`) e Sola Lettura Rigorosa su Tutte le Pagine
- [ ] **Stato esecuzione**
- **Precondizioni**: Utente `istruttore@palestra.it` (`is_instructor = true`, `is_manager = false`, `is_assistant_manager = false`) autenticato nella sede attiva.
- **Passi operativi**:
  1. Osservare le voci della **Navbar Lavoratore** (sia desktop sia mobile) e provare a navigare manualmente su `http://localhost:3000/worker`.
  2. Visitare `/worker/calendar`: verificare la barra superiore e provare a cliccare su uno slot orario vuoto; cliccare poi su una lezione esistente.
  3. Visitare `/worker/classes` e cliccare su **Visualizza** di un corso (`/worker/classes/[id]`). Provare anche ad aprire `/worker/classes/new`.
  4. Visitare `/worker/schedules` e cliccare su **Visualizza** di una lezione (`/worker/schedules/[id]`). Provare anche ad aprire `/worker/schedules/new`.
  5. Visitare `/worker/subscriptions` e cliccare su **Visualizza** di un abbonamento (`/worker/subscriptions/[id]`). Provare anche ad aprire `/worker/subscriptions/new`.
  6. Visitare `/worker/user-subscriptions` e `/worker/user-subscriptions?user=<id_cliente>`.
  7. Visitare `/worker/users` e cliccare su **Visualizza** di un cliente (`/worker/users/[id]`). Provare anche ad aprire `/worker/users/new`.
  8. Dalla console browser (DevTools), eseguire chiamate API dirette di scrittura con la sessione dell'Istruttore:
     ```javascript
     await fetch('/api/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', color: 'red' }) }).then(r => r.status)
     await fetch('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test', classIds: [] }) }).then(r => r.status)
     await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', surname: 'B', phoneNumber: '+393331234567', email: 'x@y.it' }) }).then(r => r.status)
     ```
- **Risultato atteso**:
  - **UI (Passo 1)**: Nella Navbar **NON compare** il pulsante `Dashboard`. Navigando manualmente su `/worker`, il middleware reindirizza automaticamente a `/worker/calendar`.
  - **UI (Passo 2 - Calendario)**: Non compare il pulsante `+ Crea lezione`; il click sugli slot vuoti è disabilitato (`canWrite === false`).
  - **UI (Passi 3-7 - Pagine e Form)**:
    - Tutte le rotte `/worker/*/new` reindirizzano automaticamente alla rispettiva lista.
    - Nelle liste non compaiono mai i pulsanti `+ Crea ...`, `Modifica`, `Elimina`, né le checkbox di selezione multipla su `/worker/users`.
    - Nelle pagine di dettaglio (`/worker/classes/[id]`, `/worker/schedules/[id]`, `/worker/subscriptions/[id]`, `/worker/users/[id]`, `/worker/user-subscriptions?user=...`), tutti gli input sono `disabled`, non compaiono i pulsanti `Salva`, `Elimina`, `+ Aggiungi sottoscrizione`, `Resetta password`, `Iscrivi cliente` o `Disiscrivi`.
  - **API (Passo 8)**: Tutte le chiamate `POST`, `PUT`, `DELETE` restituiscono HTTP `403` con messaggio `Permessi insufficienti: operazione riservata al gerente o ai vice gerenti.`.

---

### TC-012: Permesso Email Istruttore — Solo agli Iscritti delle Proprie Lezioni
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - Lezione A (`scheduleId_A`) con almeno 1 cliente iscritto e assegnata all'istruttore `istruttore@palestra.it` (`instructor_id = id_istruttore`).
  - Lezione B (`scheduleId_B`) con almeno 1 cliente iscritto ma senza istruttore (o assegnata a un altro istruttore).
- **Passi operativi**:
  1. Loggarsi come `istruttore@palestra.it`.
  2. Aprire il dettaglio della **Lezione A** (`/worker/schedules/<scheduleId_A>`).
  3. Verificare la presenza del pulsante **✉ Invia email agli iscritti (1)** (`[data-testid="email-enrolled-btn"]`), cliccarlo, inserire il messaggio `Portate il tappetino personale per la lezione di oggi.` e cliccare **Invia email**.
  4. Aprire il dettaglio della **Lezione B** (`/worker/schedules/<scheduleId_B>`): verificare l'assenza del pulsante **✉ Invia email agli iscritti**.
  5. Dalla console browser, forzare una chiamata `POST /api/schedules/<scheduleId_B>/email` con body `{ "message": "Tentativo non autorizzato" }`.
- **Risultato atteso**:
  - **UI + Email (Passo 3 - Propria lezione)**: Il pulsante è visibile; l'invio mostra il banner verde `Email inviata con successo a 1 iscritti.` e nella console del server compare l'email con oggetto `Comunicazione lezione "<Nome Corso>" (<Data>) - Palestra Centrale` e mittente `Luca Verdi`.
  - **UI + API (Passi 4-5 - Lezione altrui)**: Nella UI il pulsante è nascosto; la chiamata API diretta restituisce HTTP `403` con messaggio esatto: `Permessi insufficienti: un istruttore può contattare esclusivamente gli iscritti alle proprie lezioni.`.

---

## 4. Gestione Utenti e Multi-Sede (`/worker/users`)

### TC-013: Creazione Nuovo Utente (Nuovo Account Globale in `users` + `users_centers`)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente (`gerente@palestra.it`) nella Sede A (`Palestra Centrale`). L'email `cliente1@palestra.it` non esiste ancora nella tabella `users`.
- **Passi operativi**:
  1. Navigare su `/worker/users` e cliccare **+ Crea cliente** (`[data-testid="create-user-btn"]`) per aprire `/worker/users/new`.
  2. Compilare il form:
     - **Nome \***: `Sara`
     - **Cognome \***: `Neri`
     - **Numero di telefono (E.164) \***: `+393333333331`
     - **Email \***: `cliente1@palestra.it`
     - Lasciare deselezionate le checkbox **Istruttore** e **Vice gerente**.
  3. Cliccare **Salva**.
  4. Ripetere la procedura per creare:
     - **Cliente 2**: `Marco Gialli`, `+393333333332`, `cliente2@palestra.it` (nessun ruolo lavoratore).
     - **Istruttore**: `Luca Verdi`, `+393332222222`, `istruttore@palestra.it` (spuntare **Istruttore**).
- **Risultato atteso**:
  - **UI**: Redirect a `/worker/users` dove i nuovi utenti compaiono nella tabella con i rispettivi badge (`Cliente`, `Istruttore`).
  - **DB**: Creata atomicamente (tramite `db.batch`) una riga in `users` (con `password_hash` PBKDF2-SHA256) e una riga in `users_centers` associata a `center_id` della Sede A, con `created_by` e `updated_by` pari all'`id` del Gerente.
  - **Email / Console**: Nel terminale viene stampata l'email di benvenuto:
    - Oggetto: `Benvenuto/a in Palestra Centrale - Credenziali di accesso`
    - Corpo contenente `Email: cliente1@palestra.it` e `Password temporanea: <12 caratteri casuali>`.

---

### TC-014: Creazione Utente già Esistente su Altra Sede (Associazione Multi-Sede senza Cambio Password) e Blocco Duplicato nella Stessa Sede
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - `cliente1@palestra.it` è già registrato nella Sede A (`Palestra Centrale`) e conosce la propria password.
  - Il Gerente `gerente@palestra.it` appartiene anche alla Sede B (`Palestra New York`).
- **Passi operativi**:
  1. **Test Blocco Duplicato nella stessa sede (Sede A)**: mentre si è in `Palestra Centrale`, andare su `/worker/users/new`, inserire `Sara`, `Neri`, `+393333333331`, `cliente1@palestra.it` (o `CLIENTE1@palestra.it` per testare il confronto case-insensitive) e cliccare **Salva**.
  2. **Test Abilitazione su Sede B (Utente già esistente in `users`)**:
     - Andare su `/settings`, cambiare la sede attiva in `Palestra New York (America/New_York)` e cliccare **Cambia sede**.
     - Andare su `/worker/users/new` e inserire: Nome `Sara`, Cognome `Neri`, Telefono `+393333333331`, Email `cliente1@palestra.it`. Cliccare **Salva**.
  3. Riportare la sede attiva del Gerente su `Palestra Centrale` da `/settings`.
- **Risultato atteso**:
  - **UI + API (Passo 1 - Duplicato nella stessa sede)**: Il salvataggio si interrompe con HTTP `409` e banner rosso: `Un utente con questo indirizzo email è già registrato in questa sede.`.
  - **UI + DB (Passo 2 - Nuova sede)**: L'utente viene abilitato in `Palestra New York`. Nella tabella `users` **non** viene creata una seconda riga e `password_hash` **non viene modificato**; viene creata solo una nuova riga in `users_centers` per la Sede B.
  - **Email / Console (Passo 2)**: Viene inviata l'email informativa (senza password temporanea) con oggetto `Abilitazione nuova sede: Palestra New York` e testo `Sei stato/a abilitato/a presso la sede Palestra New York. Puoi accedere alla nuova sede utilizzando le tue credenziali abituali e selezionando la sede dalle Impostazioni.`.

---

### TC-015: Gerarchia Ruoli — Creazione/Modifica Vice Gerenti e Unicità/Inamovibilità del Gerente
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente (`gerente@palestra.it`) in `Palestra Centrale`.
- **Passi operativi**:
  1. Da Gerente, andare su `/worker/users/new`, inserire `Giulia`, `Bianchi`, `+393331111111`, `vice@palestra.it`, spuntare la checkbox **Vice gerente** (`is_assistant_manager`) e cliccare **Salva**. Annotare la password temporanea dalla console.
  2. Da Gerente, aprire la propria scheda `/worker/users/<id_gerente>`: verificare lo stato del ruolo Gerente e l'assenza del pulsante di eliminazione.
  3. Effettuare il logout e accedere come **Vice Gerente** (`vice@palestra.it`).
  4. Da Vice Gerente, andare su `/worker/users/new`: verificare che la checkbox **Vice gerente** non sia selezionabile/visibile.
  5. Da Vice Gerente, aprire la scheda di `cliente1@palestra.it` (`/worker/users/<id_cliente1>`) e quella di `vice@palestra.it`: verificare che la checkbox **Vice gerente** sia disabilitata (`(modificabile solo dal Gerente)`).
  6. Dalla console browser (loggato come Vice Gerente), forzare le chiamate API:
     - `POST /api/users` con `{ "name": "Test", "surname": "Vice", "phoneNumber": "+393339999999", "email": "vice2@palestra.it", "isAssistantManager": true }`
     - `PUT /api/users/<id_cliente1>/roles` con `{ "isInstructor": false, "isAssistantManager": true }`
     - `DELETE /api/users/<id_gerente>`
- **Risultato atteso**:
  - **UI (Passo 2)**: Nella scheda del Gerente compare l'avviso `Questo utente è il Gerente della sede (ruolo unico e non rimovibile).` e il pulsante `Elimina utente` non è presente (né nella lista né nel dettaglio).
  - **UI + API (Passi 4-6)**:
    - La chiamata `POST /api/users` con `isAssistantManager: true` da Vice Gerente restituisce HTTP `403`: `Permessi insufficienti: solo il gerente può creare altri vice gerenti.`.
    - La chiamata `PUT /api/users/:id/roles` per modificare `isAssistantManager` da Vice Gerente restituisce HTTP `403`: `Permessi insufficienti: solo il gerente può modificare il ruolo di vice gerente.`.
    - La chiamata `DELETE /api/users/<id_gerente>` restituisce HTTP `409`: `Impossibile eliminare il gerente della sede.`.

---

### TC-016: Blocco Rimozione Ruolo `is_instructor` con Lezioni Non Terminate
- [ ] **Stato esecuzione**
- **Precondizioni**: L'istruttore `istruttore@palestra.it` ha almeno una lezione assegnata in stato `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING` o `ACTIVE` (es. creata su `/worker/schedules/new`).
- **Passi operativi**:
  1. Loggarsi come Gerente (`gerente@palestra.it`).
  2. Navigare su `/worker/users/<id_istruttore>`.
  3. Deselezionare la checkbox **Istruttore** e cliccare **Salva**.
- **Risultato atteso**:
  - **UI + API**: L'operazione viene bloccata con HTTP `409` e banner di errore rosso: `Impossibile rimuovere il ruolo di istruttore: l'utente ha lezioni assegnate in stato bozza, pubblicata, iscrizioni aperte, in partenza o in corso.`.
  - **DB**: In `users_centers`, `is_instructor` rimane `1` (`true`).

---

### TC-017: Blocchi Eliminazione Utente (Lezioni Attive, Sottoscrizioni Attive, Istruttore con Lezioni Non Terminate)
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - Caso A: `istruttore@palestra.it` ha una lezione assegnata non terminata.
  - Caso B: `cliente1@palestra.it` possiede una sottoscrizione d'abbonamento attiva (`end_date` futura o `NULL` e `remaining_entrances >= 1` o `NULL`).
  - Caso C: `cliente1@palestra.it` è iscritto (o in coda durante `ENROLLING`) a una lezione in stato `ENROLLING`, `UPCOMING` o `ACTIVE`.
- **Passi operativi**:
  1. Da Gerente, aprire `/worker/users/<id_istruttore>`, cliccare **Elimina utente** (`[data-testid="delete-user-btn"]`) e confermare nel popup **Elimina**.
  2. Aprire `/worker/users/<id_cliente1>` (con sottoscrizione attiva ma senza iscrizioni a lezioni), cliccare **Elimina utente** e confermare.
  3. Iscrivere `cliente1@palestra.it` a una lezione attiva (`ENROLLING`), poi tentare di eliminare `cliente1@palestra.it`.
- **Risultato atteso**:
  - **Caso A (Istruttore)**: Blocco HTTP `409` con messaggio: `Impossibile eliminare l'utente: ha lezioni assegnate come istruttore non ancora terminate.`.
  - **Caso B (Sottoscrizione attiva)**: Blocco HTTP `409` con messaggio: `Impossibile eliminare l'utente: possiede sottoscrizioni d'abbonamento ancora attive.`.
  - **Caso C (Iscritto a lezione attiva)**: Blocco HTTP `409` con messaggio: `Impossibile eliminare l'utente: risulta iscritto a lezioni attive.`.
  - **DB**: In tutti e 3 i casi `users_centers.deleted_at` rimane `NULL`.

---

### TC-018: Reset Password da Gerente e Invio Email Singola / Multipla ai Clienti
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente (`gerente@palestra.it`) su `/worker/users`.
- **Passi operativi**:
  1. **Reset Password (`POST /api/users/:id/reset-password`)**:
     - Aprire la scheda di `cliente2@palestra.it` (`/worker/users/<id_cliente2>`).
     - Cliccare **Resetta password** (`[data-testid="reset-user-password-btn"]`) e confermare nel dialog **Resetta e invia email**.
  2. **Email Singola dalla scheda cliente**:
     - Nella stessa scheda, cliccare **✉ Invia email al cliente** (`[data-testid="email-single-user-btn"]`).
     - Inserire Oggetto `Avviso certificato medico` e Messaggio `Ti ricordiamo di consegnare il certificato medico rinnovato entro fine mese.`. Cliccare **Invia email**.
  3. **Email Multipla dalla lista clienti (`POST /api/users/email`)**:
     - Tornare su `/worker/users`.
     - Selezionare le checkbox di `cliente1@palestra.it` e `cliente2@palestra.it`.
     - Cliccare **✉ Invia email ai selezionati (2)** (`[data-testid="email-selected-users-btn"]`).
     - Lasciare l'oggetto vuoto (per testare il fallback) e scrivere nel messaggio `Chiusura straordinaria per festività il prossimo lunedì.`. Cliccare **Invia email**.
- **Risultato atteso**:
  - **Passo 1 (Reset Password)**: Banner verde `Nuova password generata e inviata via email a cliente2@palestra.it.`. Nel DB `users.password_hash` di `cliente2` è aggiornato. Nella console compare l'email con oggetto `Nuova password generata - Palestra Centrale` e la nuova password di 12 caratteri.
  - **Passo 2 (Email Singola)**: Banner verde `Email inviata con successo a cliente2@palestra.it.`. Nella console compare l'email con oggetto `Avviso certificato medico - Palestra Centrale`.
  - **Passo 3 (Email Multipla)**: Banner verde `Email inviata con successo a 2 destinatari.`. Nella console compare l'email indirizzata a `cliente1@palestra.it, cliente2@palestra.it` con oggetto di default `Comunicazione dalla sede Palestra Centrale`.

---

### TC-019: Partial Unique Index post Soft-Delete (`users_centers(center_id, user_id) WHERE deleted_at IS NULL`)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente in `Palestra Centrale`.
- **Passi operativi**:
  1. Creare un nuovo cliente di test su `/worker/users/new`: Nome `Temp`, Cognome `Utente`, Telefono `+393338888888`, Email `temp.softdelete@palestra.it`. Cliccare **Salva**.
  2. Dalla lista `/worker/users`, cliccare **Elimina** sulla riga di `Temp Utente` (che non ha né lezioni né sottoscrizioni attive) e confermare nel popup.
  3. Verificare nel DB D1 locale lo stato della riga in `users_centers`.
  4. Tornare su `/worker/users/new` e creare nuovamente l'utente nella **stessa sede** con la **stessa identica email** `temp.softdelete@palestra.it`, Nome `Temp`, Cognome `Rientrato`, Telefono `+393338888889`. Cliccare **Salva**.
- **Risultato atteso**:
  - **DB (Passo 3)**: La prima riga in `users_centers` non è stata cancellata fisicamente ma ha `deleted_at` valorizzato con timestamp UTC ISO 8601.
  - **UI + DB (Passo 4)**: La ricreazione nella stessa sede riesce con HTTP `200` **senza alcun errore SQLite `UNIQUE constraint failed`**, grazie al partial unique index `users_centers_center_user_active_idx ON users_centers(center_id, user_id) WHERE deleted_at IS NULL`. Nel DB esistono ora 2 righe in `users_centers` per quella coppia `(center_id, user_id)`: una storica con `deleted_at IS NOT NULL` e una attiva con `deleted_at IS NULL`.

---

## 5. Gestione Corsi (`/worker/classes`)

### TC-020: Creazione Corso con i 10 Colori Consentiti e Default `black`
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente o Vice Gerente.
- **Passi operativi**:
  1. Navigare su `/worker/classes` e cliccare **+ Crea corso** (`/worker/classes/new`).
  2. Verificare che siano selezionabili esattamente i 10 colori previsti da specifica:
     - `Nero` (`black`, selezionato di default)
     - `Bianco` (`white`)
     - `Rosso` (`red`)
     - `Blu` (`blue`)
     - `Verde` (`green`)
     - `Giallo` (`yellow`)
     - `Arancione` (`orange`)
     - `Viola` (`purple`)
     - `Rosa` (`pink`)
     - `Ciano` (`cyan`)
  3. Creare il **Corso 1**: Nome `Pilates Matwork`, Colore `Viola` (`purple`), Descrizione `Corso posturale e rinforzo core a corpo libero.`. Cliccare **Salva**.
  4. Creare il **Corso 2**: Nome `Yoga Vinyasa`, Colore `Verde` (`green`), lasciando la Descrizione vuota (`NULL`). Cliccare **Salva**.
- **Risultato atteso**:
  - **UI**: I corsi `Pilates Matwork` e `Yoga Vinyasa` compaiono in `/worker/classes` con il badge del colore corrispondente; testare ordinamento e filtro di ricerca nella tabella.
  - **DB**: Righe inserite nella tabella `classes` con `description = NULL` quando lasciata vuota, `color` conforme al vincolo `CHECK (color IN ('black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'cyan'))` e colonne di audit valorizzate.

---

### TC-021: Modifica Corso — Notifica Email su Cambio Nome/Descrizione vs Nessuna Notifica su Cambio Solo Colore
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - Il corso `Pilates Matwork` ha almeno una lezione futura in stato `ENROLLING` (o `UPCOMING`) con almeno un cliente iscritto (`is_queued = false`, es. `cliente1@palestra.it`).
- **Passi operativi**:
  1. **Modifica solo del Colore**:
     - Aprire `/worker/classes/<id_pilates>`.
     - Cambiare il colore da `Viola` (`purple`) a `Blu` (`blue`), lasciando invariati Nome e Descrizione.
     - Cliccare **Salva**.
  2. **Modifica di Nome e/o Descrizione**:
     - Riaprire `/worker/classes/<id_pilates>`.
     - Modificare il Nome in `Pilates Matwork Avanzato` e la Descrizione in `Corso posturale avanzato con piccoli attrezzi.`.
     - Cliccare **Salva**.
     - Verificare la comparsa del popup di conferma **Avvisa gli iscritti al corso**.
     - Lasciare spuntata l'opzione `Invia email di avviso a tutti gli iscritti alle lezioni attive del corso`, inserire nel campo messaggio opzionale `Da questa settimana useremo anche il ring.` e cliccare **Salva modifiche**.
- **Risultato atteso**:
  - **UI + Email (Passo 1 - Solo colore)**: Il salvataggio avviene immediatamente **senza** mostrare il popup di conferma email e **senza** inviare alcuna email nella console.
  - **UI + Email (Passo 2 - Nome/Descrizione)**: Compare il popup di conferma; confermando, il corso viene aggiornato e nella console compare l'email inviata a `cliente1@palestra.it`:
    - Oggetto: `Aggiornamento corso "Pilates Matwork Avanzato" - Palestra Centrale`
    - Corpo contenente il vecchio nome (`Pilates Matwork`), il nuovo nome (`Pilates Matwork Avanzato`), la nuova descrizione e il blocco `Messaggio dalla direzione: Da questa settimana useremo anche il ring.`.

---

### TC-022: Blocco Eliminazione Corso (HTTP `409`) con Lezioni Non Terminate vs Eliminazione Consentita
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - `Pilates Matwork Avanzato` ha almeno una lezione in stato `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING` o `ACTIVE`.
  - Creare un corso temporaneo `Corso Test Eliminazione` (colore `Rosso`).
- **Passi operativi**:
  1. Aprire `/worker/classes/<id_pilates>`, cliccare **Elimina corso** (`[data-testid="delete-class-btn"]`).
  2. Osservare l'avviso nel popup (`Attenzione: questo corso ha X lezioni non terminate...`) e cliccare comunque **Elimina**.
  3. Aprire `/worker/classes/<id_corso_test_eliminazione>` (senza lezioni attive, oppure dopo aver annullato tutte le sue lezioni portandole in `CANCELLED_BY_PROVIDER`), cliccare **Elimina corso** e confermare **Elimina**.
- **Risultato atteso**:
  - **UI + API (Passo 2)**: Il backend blocca l'eliminazione con HTTP `409` e mostra il banner di errore: `Impossibile eliminare il corso: esistono lezioni in stato bozza, pubblicata, iscrizioni aperte, in partenza o in corso. Elimina prima tali lezioni.`. Nel DB `classes.deleted_at` resta `NULL`.
  - **UI + DB (Passo 3)**: Il corso `Corso Test Eliminazione` viene eliminato soft (`classes.deleted_at` valorizzato) e scompare dalla lista `/worker/classes`.

---

## 6. Gestione Abbonamenti e Sottoscrizioni (`/worker/subscriptions` e `/worker/user-subscriptions`)

### TC-023: Creazione Abbonamento (Entrate Limitate vs Illimitate, Durata in Giorni vs Illimitata, Obbligo Almeno un Corso)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente; corsi `Pilates Matwork Avanzato` e `Yoga Vinyasa` presenti nella sede.
- **Passi operativi**:
  1. Navigare su `/worker/subscriptions/new`.
  2. **Test vincolo almeno 1 corso**: inserire Nome `Abbonamento Senza Corsi`, non selezionare alcun corso e cliccare **Salva**.
  3. **Creazione Template 1 (Entrate limitate e Durata limitata)**:
     - **Nome dell'abbonamento \***: `Carnet 10 Ingressi Pilates & Yoga`
     - **Numero di entrate**: `10`
     - **Durata in giorni**: `30`
     - **Corsi associati \***: selezionare sia `Pilates Matwork Avanzato` sia `Yoga Vinyasa`.
     - **Descrizione**: `Carnet valido 30 giorni per 10 lezioni.`
     - Cliccare **Salva**.
  4. **Creazione Template 2 (Entrate illimitate `NULL` e Durata illimitata `NULL`)**:
     - Andare su `/worker/subscriptions/new`.
     - **Nome dell'abbonamento \***: `Open Pass Illimitato`
     - **Numero di entrate**: lasciare vuoto (`NULL`).
     - **Durata in giorni**: lasciare vuoto (`NULL`).
     - **Corsi associati \***: selezionare `Pilates Matwork Avanzato`.
     - Cliccare **Salva**.
- **Risultato atteso**:
  - **UI (Passo 2)**: Errore di validazione Zod sotto la selezione corsi: `Selezionare almeno un corso abilitato.`.
  - **UI + DB (Passi 3-4)**: Entrambi i template vengono creati in transazione atomica (`subscriptions` + `subscriptions_classes`). Per `Open Pass Illimitato`, nel DB `entrances IS NULL` e `duration_days IS NULL`, e nella tabella UI viene mostrato `Illimitate` / `Illimitata`.

---

### TC-024: Modifica Abbonamento — Campi Strutturali in Sola Lettura (UI + Forzatura Payload API)
- [ ] **Stato esecuzione**
- **Precondizioni**: Template `Carnet 10 Ingressi Pilates & Yoga` (`entrances = 10`, `duration_days = 30`) esistente.
- **Passi operativi**:
  1. Aprire `/worker/subscriptions/<id_carnet>`.
  2. Verificare che i campi **Numero di entrate**, **Durata in giorni** e i pulsanti **Corsi associati** siano disabilitati (`disabled`) con la dicitura `Campo strutturale non modificabile dopo la creazione.`.
  3. Modificare il **Nome** in `Carnet 10 Ingressi Fitness` e la **Descrizione** in `Descrizione aggiornata.` e cliccare **Salva**.
  4. Dalla console browser, inviare una chiamata `PUT /api/subscriptions/<id_carnet>` forzando nel JSON anche campi strutturali:
     ```javascript
     await fetch('/api/subscriptions/<id_carnet>', {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         name: 'Carnet 10 Ingressi Fitness',
         description: 'Descrizione aggiornata.',
         entrances: 999,
         durationDays: 365,
         classIds: []
       })
     }).then(r => r.json())
     ```
- **Risultato atteso**:
  - **UI + API + DB**: `name` e `description` vengono aggiornati, mentre `entrances` resta `10`, `duration_days` resta `30` e le righe in `subscriptions_classes` restano invariate (lo schema `updateSubscriptionSchema` e l'endpoint ignorano qualsiasi modifica ai campi strutturali).

---

### TC-025: Assegnazione Sottoscrizione a Utente (Pre-compilazione e Ricalcolo `end_date`) e Blocco Eliminazione Template Abbonamento
- [ ] **Stato esecuzione**
- **Precondizioni**: Template `Carnet 10 Ingressi Fitness` (`10` entrate, `30` giorni) e cliente `cliente1@palestra.it` esistenti.
- **Passi operativi**:
  1. Aprire la scheda di `cliente1@palestra.it` (`/worker/users/<id_cliente1>`) e cliccare **+ Aggiungi sottoscrizione** (`[data-testid="add-user-subscription-btn"]`).
  2. Selezionare dal menu a tendina `Carnet 10 Ingressi Fitness`.
  3. Osservare il riquadro di anteprima: **Entrate pre-compilate: 10 entrate** e **Data di scadenza calcolata**.
  4. Modificare la **Data d'inizio** impostando il giorno successivo a oggi: verificare che la **Data di scadenza calcolata** nell'anteprima si aggiorni istantaneamente a `start_date + 30 giorni`. Riportare la **Data d'inizio** a oggi e cliccare **Salva sottoscrizione**.
  5. Navigare ora su `/worker/subscriptions/<id_carnet>`, cliccare **Elimina abbonamento** (`[data-testid="delete-subscription-btn"]`) e confermare **Elimina**.
- **Risultato atteso**:
  - **UI + DB (Passo 4)**: La sottoscrizione viene creata in `users_subscriptions` con `entrances = 10`, `end_date = start_date + 30 giorni`, e `remaining_entrances` calcolato dinamicamente pari a `10`.
  - **UI + API (Passo 5 - Blocco eliminazione template)**: L'eliminazione del template viene bloccata con HTTP `409` e messaggio: `Impossibile eliminare l'abbonamento: esistono clienti con una sottoscrizione attiva associata a questo abbonamento.`.

---

### TC-026: Blocchi Modifica ed Eliminazione Sottoscrizione Utente (`/worker/user-subscriptions?user=userId`)
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - `cliente1@palestra.it` ha la sottoscrizione attiva `Carnet 10 Ingressi Fitness` (iniziata oggi, scadenza tra 30 giorni).
  - Creare una lezione di `Pilates Matwork Avanzato` in stato `ENROLLING` programmata tra **5 giorni** e iscrivere `cliente1@palestra.it` (così che `usedEntrances = 1` e ci sia una lezione prenotata tra 5 giorni).
- **Passi operativi**:
  1. Dalla scheda di `cliente1@palestra.it`, cliccare sulla card della sottoscrizione (o su **Gestisci sottoscrizioni →**) per aprire `/worker/user-subscriptions?user=<id_cliente1>`.
  2. Verificare i contatori visualizzati: `Entrate utilizzate: 1 · Entrate rimanenti: 9 su 10`.
  3. **Blocco 1 (`end_date` antecedente a lezione prenotata/in coda)**: modificare il campo **Data di fine** impostando una data tra **2 giorni** (quindi successiva a `start_date` ma antecedente alla lezione del 5° giorno) e cliccare **Salva modifiche**.
  4. **Blocco 2 (`entrances` < entrate già utilizzate)**: (dopo aver iscritto il cliente ad almeno 2 lezioni, così che `usedEntrances = 2`, oppure forzando via API `PUT /api/user-subscriptions/<id>` con `{ "endDate": "<data_valida>", "entrances": 0 }` o `< usedEntrances`) tentare di impostare **Entrate totali** a `1` quando `usedEntrances = 2` e cliccare **Salva modifiche**.
  5. **Blocco 3 (Eliminazione sottoscrizione con lezioni future attive/in coda)**: cliccare **Elimina sottoscrizione** e confermare nel popup **Elimina**.
  6. **Modifica valida**: impostare **Entrate totali** a `12` e **Data di fine** tra `45` giorni, poi cliccare **Salva modifiche**.
- **Risultato atteso**:
  - **Passo 3 (`end_date` < data lezione)**: Blocco HTTP `409` con messaggio: `La nuova data di fine è antecedente a lezioni a cui il cliente è già iscritto o in coda.`.
  - **Passo 4 (`entrances` < `usedEntrances`)**: Blocco con messaggio: `Il nuovo numero di entrate totali non può essere inferiore alle entrate già utilizzate.` (HTTP `409` da backend).
  - **Passo 5 (Eliminazione bloccata)**: Blocco HTTP `409` con messaggio: `Impossibile eliminare la sottoscrizione: esistono lezioni attive o in coda future collegate a questa sottoscrizione.`.
  - **Passo 6 (Modifica valida)**: Banner verde `Sottoscrizione «Carnet 10 Ingressi Fitness» aggiornata con successo.` e `Entrate rimanenti` aggiornato dinamicamente a `11 su 12`.

---

## 7. Calendario, Creazione Ricorrente e gli 8 Stati della Lezione (`/worker/calendar` e `/worker/schedules`)

### TC-027: Interazione Calendario Desktop (Settimanale/Mensile) e Mobile (Giornaliero)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente su `/worker/calendar`.
- **Passi operativi**:
  1. **Su Desktop (`>= 768px`)**:
     - Verificare che la vista predefinita all'apertura sia **Settimanale** (`[data-testid="view-toggle-week"]` attivo) posizionata sulla settimana corrente.
     - Cliccare sulle frecce `<` (`[data-testid="desktop-prev-btn"]`) e `>` (`[data-testid="desktop-next-btn"]`) e poi su **Oggi**.
     - Cliccare su **Mensile** (`[data-testid="view-toggle-month"]`): verificare la griglia mensile Lun-Dom e il selettore mese/anno (`type="month"`).
     - Tornare in vista **Settimanale** e cliccare su uno **slot vuoto** (es. Giovedì ore `10:00`).
  2. **Su Mobile (`< 768px`)**:
     - Ridimensionare la finestra a larghezza mobile (`390px`).
     - Verificare che venga mostrata la **griglia oraria giornaliera** con selettore giorno, frecce `<` (`[data-testid="mobile-prev-day-btn"]`) e `>` (`[data-testid="mobile-next-day-btn"]`) e pulsante `+ Crea lezione` (`[data-testid="mobile-create-schedule-btn"]`).
     - Cliccare su uno slot vuoto delle ore `15:00`.
- **Risultato atteso**:
  - **UI (Desktop & Mobile)**: Il click su uno slot vuoto apre `/worker/schedules/new?date=<YYYY-MM-DD>&time=<HH:00>` con i campi **Data d'inizio**, **Data di fine**, **Giorno della settimana** corrispondente e **Ora d'inizio** già precompilati con la data e l'ora dello slot cliccato.

---

### TC-028: Creazione Ricorrente Lezioni e Vincoli di Validazione (Step 5 min, Capienza, Ordine Cronologico, Margine 5 min)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente su `/worker/schedules/new`.
- **Passi operativi**:
  1. **Test Step 5 minuti**: provare a inserire un'ora d'inizio non multipla di 5 minuti (es. `18:03`) o una durata di `3` minuti (o `12` minuti) o minuti di pubblicazione/apertura non multipli di 5 (es. `7` minuti) e cliccare **Salva**.
  2. **Test Vincolo `available_spots >= minimum_spots`**: impostare **Numero di posti minimo** = `5` e **Numero di posti massimo** = `3` -> cliccare **Salva**.
  3. **Test Vincolo Ordine Cronologico (`publication >= registration_open >= registration_close`)**:
     - Impostare **Visibile prima dell'inizio** = `2` ore (`120` min) e lasciare **Apertura iscrizioni** vuoto (`subito iscrivibile`) -> cliccare **Salva**.
     - Impostare **Visibile prima dell'inizio** = `2` ore (`120` min) e **Apertura iscrizioni** = `4` ore (`240` min) -> cliccare **Salva**.
     - Impostare **Apertura iscrizioni** = `1` ora (`60` min) e **Chiusura iscrizioni** = `2` ore (`120` min) -> cliccare **Salva**.
  4. **Test Vincolo Margine di Creazione (`start_date - close_offset > now() + 5 minuti`)**:
     - Impostare Data d'inizio = Oggi, Ora d'inizio = tra 15 minuti (arrotondato a 5 min), e **Chiusura iscrizioni prima dell'inizio** = `12` minuti (così che la chiusura iscrizioni cada tra `3` minuti, cioè `<= now() + 5 minuti`). Cliccare **Salva**.
  5. **Creazione Ricorrente Valida su più settimane**:
     - **Corso**: `Pilates Matwork Avanzato`
     - **Istruttore**: `Luca Verdi`
     - **Data d'inizio**: Lunedì della prossima settimana
     - **Data di fine**: Domenica di due settimane dopo (intervallo di 2 settimane)
     - **Giorni della settimana**: selezionare `Martedì` e `Giovedì`
     - **Ora d'inizio**: `18:00`
     - **Durata**: `1` ora, `0` minuti (`60` min)
     - **Numero di posti minimo**: `2`
     - **Numero di posti massimo**: `10`
     - Lasciare vuoti i campi facoltativi di visibilità/apertura/chiusura (`NULL`).
     - Cliccare **Salva**.
- **Risultato atteso**:
  - **Passo 1**: Blocco con messaggi Zod: `L'orario deve essere valido e avere incrementi di 5 minuti.`, `La durata minima della lezione è di 5 minuti.` / `La durata deve avere incrementi di 5 minuti.`, `I minuti prima della pubblicazione devono avere incrementi di 5 minuti.`.
  - **Passo 2**: Blocco con messaggio: `Il numero di posti massimi deve essere maggiore o uguale al numero di posti minimi.`.
  - **Passo 3**: Blocco con i rispettivi messaggi:
    - `Le iscrizioni non possono essere subito aperte se la lezione ha un orario di pubblicazione posticipato.`
    - `L'apertura delle iscrizioni non può precedere la pubblicazione della lezione.`
    - `La chiusura delle iscrizioni non può precedere l'apertura delle iscrizioni.`
  - **Passo 4**: Blocco HTTP `400` con messaggio esatto: `La chiusura delle iscrizioni della lezione deve avvenire almeno 5 minuti nel futuro rispetto ad ora.`.
  - **Passo 5**: Creazione atomica in D1 batch di **4 lezioni** (2 Martedì + 2 Giovedì alle 18:00 locali di `Europe/Rome`) e redirect a `/worker/calendar` dove le 4 lezioni sono visibili.

---

### TC-029: Verifica degli 8 Stati Dinamici della Lezione (`status`)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente in una finestra browser e come Cliente (`cliente1@palestra.it`) in una finestra in incognito. Ricordare che `schedules.status` non è mai salvato nel DB ma viene ricalcolato dinamicamente ad ogni richiesta secondo la formula di `SPECIFICATION.md`.
- **Passi operativi**:
  1. **Stato 1 — `DRAFT` (`Bozza`)**:
     - Creare una lezione domani alle `18:00` con **Visibile prima dell'inizio** = `2` ore (`120` min), **Apertura iscrizioni** = `1` ora (`60` min), **Chiusura iscrizioni** = `15` min.
     - Poiché `now < start_date - 120 min`, verificare lo stato su `/worker/schedules` e la visibilità su `/customer` (selezionando domani).
  2. **Stato 2 — `PUBLISHED` (`Pubblicata`)**:
     - Creare una lezione domani alle `18:00` con **Visibile prima dell'inizio** vuoto (`NULL`, quindi subito visibile) e **Apertura iscrizioni** = `2` ore (`120` min).
     - Poiché `publicationAt <= now < start_date - 120 min`, verificare lo stato su `/worker/schedules` e come appare su `/customer`.
  3. **Stato 3 — `ENROLLING` (`Iscrizioni aperte`)**:
     - Creare una lezione domani alle `19:00` con `publication = NULL`, `open = NULL`, `close = 60` min, `minimum_spots = 1`, `available_spots = 5`.
     - Verificare lo stato su `/worker/schedules` e su `/customer`. Iscrivere `cliente1@palestra.it` a questa lezione.
  4. **Stato 4 — `UPCOMING` (`In partenza`)**:
     - Sulla lezione del punto 3 (che ha `enrolled_count = 1 >= minimum_spots = 1`), aggiornare via D1 locale `start_date` a `now + 30 minuti` (con `registration_close_minutes_before = 60`, così che `start_date - 60m <= now < start_date`):
       ```powershell
       npx wrangler d1 execute app-calendario-palestra-db --local --command "UPDATE schedules SET start_date = strftime('%Y-%m-%dT%H:%M:00.000Z', 'now', '+30 minutes'), created_at = strftime('%Y-%m-%dT%H:%M:00.000Z', 'now', '-2 hours') WHERE id = '<ID_LEZIONE>';"
       ```
     - Ricaricare `/worker/schedules` e `/customer`.
  5. **Stato 5 — `ACTIVE` (`In corso`)**:
     - Aggiornare via D1 locale `start_date` della stessa lezione (con `enrolled_count = 1 >= minimum_spots = 1` e `duration_minutes = 60`) a `now - 10 minuti`:
       ```powershell
       npx wrangler d1 execute app-calendario-palestra-db --local --command "UPDATE schedules SET start_date = strftime('%Y-%m-%dT%H:%M:00.000Z', 'now', '-10 minutes'), registration_close_minutes_before = NULL WHERE id = '<ID_LEZIONE>';"
       ```
     - Ricaricare `/worker/schedules` e `/customer`.
  6. **Stato 6 — `COMPLETED` (`Terminata` / `Completata`)**:
     - Aggiornare via D1 locale `start_date` della stessa lezione a `now - 90 minuti`:
       ```powershell
       npx wrangler d1 execute app-calendario-palestra-db --local --command "UPDATE schedules SET start_date = strftime('%Y-%m-%dT%H:%M:00.000Z', 'now', '-90 minutes') WHERE id = '<ID_LEZIONE>';"
       ```
     - Ricaricare `/worker/schedules`.
  7. **Stato 7 — `CANCELLED_LOW_ENROLLMENT` (`Annullata (iscritti minimi non raggiunti)`)**:
     - Creare una lezione con `minimum_spots = 3`, `0` iscritti, e portare la sua chiusura iscrizioni nel passato (`start_date = now + 20 minuti`, `registration_close_minutes_before = 30`).
     - Ricaricare `/worker/schedules` e `/customer`.
  8. **Stato 8 — `CANCELLED_BY_PROVIDER` (`Annullata dal gerente`)**:
     - Aprire da Gerente una lezione in stato `ENROLLING` e cliccare **Elimina lezione** (`[data-testid="delete-schedule-btn"]`) -> confermare.
- **Risultato atteso**:
  - **`DRAFT`**: Visibile al lavoratore con badge `Bozza`; **completamente invisibile** ai clienti in `/customer` (`GET /api/schedules?mode=customer` esclude i `DRAFT`).
  - **`PUBLISHED`**: Badge `Pubblicata` per il lavoratore; visibile al cliente in `/customer` con label stato `Iscrizioni chiuse` e **senza** pulsante `Iscriviti`.
  - **`ENROLLING`**: Badge `Iscrizioni aperte` per il lavoratore; in `/customer` mostra label `Iscrizioni aperte` (o `Iscritto` / `Coda (#1)` dopo l'iscrizione) e il pulsante `Iscriviti` / `Disiscriviti`.
  - **`UPCOMING`**: Badge `In partenza` per il lavoratore; in `/customer` mostra `Iscritto in partenza` per l'iscritto e `Iscrizioni chiuse` per chi non è iscritto, senza pulsante di azione.
  - **`ACTIVE`**: Badge `In corso` sia per il lavoratore sia per il cliente.
  - **`COMPLETED`**: Badge `Terminata` per il lavoratore (`Completata` nel formatter cliente).
  - **`CANCELLED_LOW_ENROLLMENT`**: Badge `Annullata (iscritti minimi non raggiunti)` per il lavoratore e `Annullato per numero minimo non raggiunto` per il cliente; card barrata a calendario.
  - **`CANCELLED_BY_PROVIDER`**: `schedules.deleted_at` valorizzato nel DB; badge `Annullata dal gerente` per il lavoratore e `Annullato dal gerente` per il cliente.

---

### TC-030: Blocchi Modifica ed Eliminazione Lezione in Base allo Stato
- [ ] **Stato esecuzione**
- **Precondizioni**: Disporre di lezioni negli stati `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED_LOW_ENROLLMENT`, `CANCELLED_BY_PROVIDER`.
- **Passi operativi**:
  1. **Modifica Lezione (`PUT /api/schedules/:id`)**:
     - Aprire una lezione in stato `DRAFT` e una in stato `PUBLISHED`: modificare la durata da `60` a `45` minuti e cliccare **Salva**.
     - Aprire una lezione in stato `ENROLLING` (e poi `UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED_*`): verificare che tutti i campi del form siano bloccati in sola lettura con il banner giallo `La modifica dei parametri della lezione è consentita solo negli stati Bozza o Pubblicata`.
     - Forzare dalla console browser una chiamata `PUT /api/schedules/<id_enrolling>` con dati validi.
  2. **Eliminazione Lezione (`DELETE /api/schedules/:id`)**:
     - Aprire una lezione in stato `DRAFT` (senza iscritti): cliccare **Elimina lezione** -> verificare che il popup **non** chieda l'opzione di invio email -> confermare.
     - Aprire una lezione in stato `ENROLLING` (o `PUBLISHED` / `UPCOMING`) **con almeno 1 cliente iscritto**: cliccare **Elimina lezione** (`[data-testid="delete-schedule-btn"]`) -> verificare la presenza della checkbox `Invia email di avviso annullamento a tutti gli iscritti della lezione` e del campo messaggio opzionale -> inserire `Istruttore indisposto, recupereremo venerdì.` e confermare **Elimina lezione**.
     - Aprire una lezione in stato `ACTIVE`, `COMPLETED` o `CANCELLED_*`: verificare l'assenza del pulsante **Elimina lezione** e forzare dalla console browser `DELETE /api/schedules/<id_active>`.
- **Risultato atteso**:
  - **Modifica**: Consentita con successo (`200`) solo in `DRAFT` e `PUBLISHED`. La chiamata API forzata su `ENROLLING` (o stati successivi) restituisce HTTP `409` con messaggio: `Impossibile modificare la lezione: la modifica è consentita solo in stato DRAFT o PUBLISHED (stato attuale: ENROLLING).`.
  - **Eliminazione**:
    - Consentita in `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING`.
    - Quando eliminata in `PUBLISHED`/`ENROLLING`/`UPCOMING` con iscritti e flag notifica attivo, viene inviata l'email con oggetto `Annullamento lezione "<Nome Corso>" del <gg/mm/aaaa> - Palestra Centrale` e testo `L'eventuale ingresso utilizzato è stato automaticamente riaccreditato sul tuo abbonamento.`.
    - La chiamata `DELETE` forzata su `ACTIVE`, `COMPLETED` o `CANCELLED_*` restituisce HTTP `409`: `Impossibile annullare la lezione: l'eliminazione è consentita solo in stato DRAFT, PUBLISHED, ENROLLING o UPCOMING (stato attuale: ACTIVE).`.

---

## 8. Iscrizioni, Code, Promozione Automatica e Conteggio Entrate (`/customer` e `/customer/summary`)

### TC-031: Esperienza Cliente (`/customer`) — Blocco Navigazione Giorni Passati e Card Corso a 4 Righe
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come `cliente1@palestra.it` su `/customer`. Esiste almeno una lezione visibile nella giornata odierna o di domani.
- **Passi operativi**:
  1. All'apertura di `/customer`, verificare che sia selezionato il **Giorno corrente** (nel fuso `center.timezone`) e che il pulsante `<` (`[data-testid="prev-day-btn"]`) sia **disabilitato** (`disabled`).
  2. Provare a forzare una data passata nell'input `<input type="date">` superiore (es. ieri): verificare che il valore venga ricondotto automaticamente alla data odierna (`todayDate`).
  3. Cliccare sul pulsante `>` (`[data-testid="next-day-btn"]`) per andare a domani: verificare che ora il pulsante `<` sia abilitato e riporti a oggi (dove torna disabilitato).
  4. Ispezionare la struttura della **Card Corso Utente** (`CustomerUserCourseCard.vue`) riga per riga:
     - **Riga 1 (`[data-testid="course-card-row-1"]`)**: a sinistra orario inizio-fine e durata (`18:00 - 19:00 (60 min)`), a destra `X posti liberi su Y` (oppure `Completo` se `remainingSpots <= 0`, oppure `Posti illimitati` se `availableSpots === null`).
     - **Riga 2 (`[data-testid="course-card-row-2"]`)**: a sinistra pallino colore + nome del corso, a destra badge stato (`[data-testid="course-card-status-label"]`).
     - **Riga 3 (`[data-testid="course-card-row-3"]`)**: a sinistra `Istruttore: <Nome Cognome>` (o `Istruttore non assegnato`).
     - **Riga 4 (`[data-testid="course-card-row-4"]`)**: a sinistra pulsante **Abbonamenti necessari** (`[data-testid="course-card-subscriptions-btn"]`), a destra pulsante **Iscriviti** / **Disiscriviti** (`[data-testid="course-card-action-btn"]`).
  5. Cliccare su **Abbonamenti necessari**: verificare l'apertura del popup modale con l'elenco degli abbonamenti abilitati per quel corso (entrate, durata, descrizione) e chiuderlo.
- **Risultato atteso**:
  - **UI**: Tutte e 4 le righe della card e il blocco sui giorni passati rispettano esattamente la tabella `GUI e routing` di `SPECIFICATION.md`.

---

### TC-032: Logica di Iscrizione — Blocchi per Assenza Sottoscrizione Idonea e Priorità Multi-Sottoscrizione (`end_date` più vicina)
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - Lezione di `Pilates Matwork Avanzato` in stato `ENROLLING` programmata tra **3 giorni**.
  - Lezione di `Pilates Matwork Avanzato` in stato `ENROLLING` programmata tra **40 giorni**.
- **Passi operativi**:
  1. **Utente senza sottoscrizione o con sottoscrizione per altro corso**:
     - Con un cliente privo di sottoscrizioni per `Pilates Matwork Avanzato`, cliccare **Iscriviti** sulla lezione tra 3 giorni.
  2. **Utente con sottoscrizione che scade prima della data della lezione**:
     - `cliente1@palestra.it` ha solo una sottoscrizione che scade tra **15 giorni**. Cliccare **Iscriviti** sulla lezione programmata tra **40 giorni**.
  3. **Edge Case Multi-Sottoscrizione (Priorità a quella che scade prima)**:
     - Da Gerente (`/worker/users/<id_cliente1>`), assicurarsi che `cliente1@palestra.it` abbia **2 sottoscrizioni attive** abilitate per `Pilates Matwork Avanzato`:
       - **Sottoscrizione A (`sub_A`)**: scade tra **30 giorni** (`10` entrate).
       - **Sottoscrizione B (`sub_B`)**: scade tra **10 giorni** (`5` entrate).
     - Loggarsi come `cliente1@palestra.it`, andare su `/customer` alla data della lezione tra **3 giorni** (coperta sia da `sub_A` sia da `sub_B`) e cliccare **Iscriviti**.
     - Andare su `/customer/summary` (o interrogare `user_schedules` nel DB) per verificare da quale sottoscrizione è stata scalata l'entrata.
- **Risultato atteso**:
  - **Passi 1 e 2**: Iscrizione bloccata con HTTP `409` e banner rosso: `Nessuna sottoscrizione d'abbonamento attiva e valida con ingressi disponibili per questo corso nella data della lezione.`.
  - **Passo 3 (Multi-Sottoscrizione)**: L'iscrizione riesce (`Iscrizione alla lezione confermata!`) e il sistema seleziona automaticamente **Sottoscrizione B (`sub_B`)** perché ha `end_date` più vicina (`4 su 5` rimanenti su `sub_B`, mentre `sub_A` resta intatta a `10 su 10`).

---

### TC-033: Iscrizione Effettuata dal (Vice) Gerente con Notifica Email al Cliente
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente (`gerente@palestra.it`). Lezione in stato `ENROLLING` a cui `cliente1@palestra.it` non è ancora iscritto (e per cui ha una sottoscrizione valida).
- **Passi operativi**:
  1. Aprire il dettaglio della lezione in `/worker/schedules/<id_lezione>`.
  2. Nella sezione **Iscritti e Coda d'attesa**, selezionare `Neri Sara — cliente1@palestra.it` dal menu a tendina e cliccare **Iscrivi cliente**.
- **Risultato atteso**:
  - **UI**: Banner verde `Cliente iscritto alla lezione con successo (inviata email di notifica).` (o `Cliente inserito in coda...` se piena); `Neri Sara` compare nella tabella **Clienti Iscritti (1)**.
  - **Email / Console**: Viene inviata l'email a `cliente1@palestra.it` con oggetto `Conferma iscrizione a "<Nome Corso>" (<Data>) - Palestra Centrale` (o `Inserimento in coda per ...` se in coda).

---

### TC-034: Gestione Coda (`is_queued`), Impegno Entrata e Promozione Automatica con Email
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - Creare una lezione di `Pilates Matwork Avanzato` per domani in stato `ENROLLING` con **`minimum_spots = 1`** e **`available_spots = 1`** (`1` solo posto massimo disponibile).
  - **Cliente 1** (`cliente1@palestra.it`) e **Cliente 2** (`cliente2@palestra.it`) hanno ciascuno una sottoscrizione attiva con `10` entrate disponibili (`remaining_entrances = 10`).
- **Passi operativi**:
  1. **Iscrizione Cliente 1 (Ultimo posto disponibile)**:
     - Loggarsi come `cliente1@palestra.it`, andare su `/customer` alla data di domani e cliccare **Iscriviti**.
     - Verificare l'etichetta posti, lo stato della card e le entrate rimanenti di Cliente 1 in `/customer/summary`.
  2. **Iscrizione Cliente 2 (Lezione piena -> Inserimento in Coda)**:
     - Loggarsi come `cliente2@palestra.it`, andare su `/customer` alla data di domani.
     - Verificare che la card mostri `Completo` in alto a destra e il pulsante **Iscriviti** in basso a destra.
     - Cliccare **Iscriviti**.
     - Verificare il messaggio di feedback, il badge sulla card e le entrate rimanenti di Cliente 2 in `/customer/summary`.
  3. **Disiscrizione di un utente in coda (Nessuna promozione errata)**:
     - Sempre come `cliente2@palestra.it`, cliccare **Disiscriviti** per uscire dalla coda, verificare che l'entrata torni a `10 su 10`, e poi cliccare nuovamente **Iscriviti** per rimettersi in coda (`Coda (#1)`).
  4. **Disiscrizione Cliente 1 e Promozione Automatica di Cliente 2**:
     - Tornare nella sessione di `cliente1@palestra.it` su `/customer` (oppure operare da Gerente su `/worker/schedules/<id_lezione>`).
     - Cliccare **Disiscriviti** per Cliente 1 mentre la lezione è in stato `ENROLLING`.
     - Controllare il terminale del server Nuxt, la pagina `/customer` di Cliente 1 e la pagina `/customer` di Cliente 2.
  5. **Blocco Disiscrizione fuori dallo stato `ENROLLING`**:
     - Portare la lezione in stato `UPCOMING` (chiusura iscrizioni superata) e tentare di disiscrivere Cliente 2 (da UI il pulsante `Disiscriviti` scompare; forzare `DELETE /api/schedules/<id_lezione>/enroll/<id_cliente2>` da console).
- **Risultato atteso**:
  - **Passo 1 (Cliente 1)**: `enrolled_count = 1`, `remaining_spots = 0` (`Completo`), badge `Iscritto`, entrate di Cliente 1 = `9 rimanenti su 10`.
  - **Passo 2 (Cliente 2 in coda)**: Compare il banner `La lezione è al completo: sei stato inserito in coda.`. Sulla card il badge mostra `Coda (#1)` e il pulsante diventa `Disiscriviti`. Nel DB `user_schedules.is_queued = 1`. In `/customer/summary` di Cliente 2 le entrate risultano **`9 rimanenti su 10`** (1 entrata è temporaneamente impegnata finché la lezione è in `ENROLLING`).
  - **Passo 3**: Quando un utente in coda si disiscrive (`wasQueued = true`), nessuno viene promosso e nessuna email di promozione viene inviata.
  - **Passo 4 (Promozione Automatica)**:
    - In un'unica transazione batch atomica D1, la riga di Cliente 1 viene soft-deleted (`deleted_at = now`) e la riga più vecchia in coda (Cliente 2) viene aggiornata a `is_queued = 0` (`false`).
    - Cliente 1 recupera immediatamente la propria entrata (`10 rimanenti su 10`).
    - Cliente 2 passa automaticamente allo stato `Iscritto` (`enrolled_count = 1`, `queued_count = 0`), mantenendo l'entrata impegnata (`9 rimanenti su 10`).
    - **Email / Console**: Viene inviata automaticamente l'email a `cliente2@palestra.it` con oggetto `Posto confermato dalla coda per "Pilates Matwork Avanzato" (<Data>) - Palestra Centrale` e testo `La tua prenotazione in coda è stata promossa e ora risulti ufficialmente iscritto/a alla lezione`.
  - **Passo 5 (Blocco in `UPCOMING`)**: Nella UI il pulsante `Disiscriviti` non è renderizzato; la chiamata API `DELETE` restituisce HTTP `409`: `Impossibile disiscriversi: le iscrizioni per questa lezione non sono aperte (stato attuale: UPCOMING).`.

---

### TC-035: Ricalcolo Dinamico `remaining_entrances` nei Casi Limite e Re-iscrizione post Soft-Delete
- [ ] **Stato esecuzione**
- **Precondizioni**: `cliente1@palestra.it` e `cliente2@palestra.it` con sottoscrizione attiva da `10` entrate.
- **Passi operativi**:
  1. **Caso Limite A — Lezione annullata dal Gerente (`CANCELLED_BY_PROVIDER`)**:
     - Creare una lezione `L1` in `ENROLLING`, iscrivere `cliente1` (entrate rimanenti scendono di 1).
     - Da Gerente, eliminare la lezione `L1` (`/worker/schedules/<id_L1>` -> **Elimina lezione**), portandola in `CANCELLED_BY_PROVIDER`.
     - Verificare `remaining_entrances` di `cliente1` su `/customer/summary`.
  2. **Caso Limite B — Lezione annullata per mancato raggiungimento minimo iscritti (`CANCELLED_LOW_ENROLLMENT`)**:
     - Creare una lezione `L2` in `ENROLLING` con `minimum_spots = 3` e `registration_close_minutes_before = 60`.
     - Iscrivere solo `cliente1` (`enrolled_count = 1 < 3`; entrate rimanenti scendono di 1).
     - Portare l'orario di chiusura iscrizioni di `L2` nel passato tramite D1 locale (`start_date = now + 30 min`), facendo passare dinamicamente `L2` in `CANCELLED_LOW_ENROLLMENT`.
     - Verificare `remaining_entrances` di `cliente1` su `/customer/summary`.
  3. **Caso Limite C — Utente rimasto in coda (`is_queued = TRUE`) quando la lezione esce da `ENROLLING`**:
     - Creare una lezione `L3` in `ENROLLING` con `minimum_spots = 1`, `available_spots = 1`, `registration_close_minutes_before = 60`.
     - Iscrivere `cliente1` (posto confermato) e poi iscrivere `cliente2` (finisce in coda con `is_queued = true`; entrate rimanenti di `cliente2` scendono di 1).
     - Portare la chiusura iscrizioni di `L3` nel passato (`start_date = now + 30 min`), così che `L3` passi in `UPCOMING` senza che `cliente2` sia stato promosso.
     - Verificare `remaining_entrances` di `cliente2` (rimasto in coda) e di `cliente1` (iscritto effettivo).
  4. **Caso Limite D — Re-iscrizione alla stessa lezione dopo Disiscrizione (Partial Unique Index `user_schedules`)**:
     - Su una lezione in stato `ENROLLING`, come `cliente1` cliccare **Iscriviti**, poi cliccare **Disiscriviti**, e infine cliccare nuovamente **Iscriviti** sulla stessa lezione.
- **Risultato atteso**:
  - **Caso A (`CANCELLED_BY_PROVIDER`)**: L'entrata torna automaticamente disponibile a `cliente1` senza bisogno di modificare la riga in `user_schedules`.
  - **Caso B (`CANCELLED_LOW_ENROLLMENT`)**: L'entrata torna automaticamente disponibile a `cliente1`.
  - **Caso C (`is_queued = TRUE` e `status !== 'ENROLLING'`)**: L'entrata impegnata da `cliente2` (rimasto in coda) **torna automaticamente disponibile**, mentre l'entrata di `cliente1` (iscritto confermato in `UPCOMING`) rimane correttamente scalata.
  - **Caso D (Re-iscrizione)**: La seconda iscrizione riesce senza errori SQLite grazie al partial unique index `user_schedules_schedule_user_active_idx ON user_schedules(schedule_id, user_id) WHERE deleted_at IS NULL`.

---

### TC-036: Pagina Riepilogo Cliente (`/customer/summary`) — Verifica delle 4 Sezioni
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come `cliente1@palestra.it`.
- **Passi operativi**:
  1. Navigare su `/customer/summary` dalla Navbar Cliente (**Riepilogo**).
  2. Verificare la presenza e il contenuto delle **4 sezioni obbligatorie**:
     - **Sezione 1 (`[data-testid="summary-active-schedules"]` — Lezioni con iscrizione attiva)**: mostra le lezioni in stato `ENROLLING` (iscritto o in coda), `UPCOMING` (iscritto) o `ACTIVE` (iscritto), usando il componente `CustomerUserCourseCard` in **sola lettura** (`readonly="true"`, nessun bottone `Iscriviti`/`Disiscriviti`).
     - **Sezione 2 (`[data-testid="summary-cancelled-schedules"]` — Lezioni annullate)**: mostra le lezioni a cui il cliente era iscritto e che sono passate in `CANCELLED_LOW_ENROLLMENT` o `CANCELLED_BY_PROVIDER`, **fino alla data e ora di fine della lezione** (`endDate >= now`).
     - **Sezione 3 (`[data-testid="summary-active-subscriptions"]` — Sottoscrizioni attive)**: mostra le sottoscrizioni non scadute e con entrate disponibili, indicando validità, entrate rimanenti su totali e i corsi inclusi con il relativo colore.
     - **Sezione 4 (`[data-testid="summary-expired-subscriptions"]` — Sottoscrizioni scadute)**: mostra le sottoscrizioni con `end_date < now` oppure con `0` entrate rimanenti (`Scaduta / Esaurita`).
  3. Portare nel passato l'orario di fine (`start_date + duration_minutes < now`) di una lezione annullata nel DB e cliccare **Aggiorna**: verificare che scompaia dalla Sezione 2.
- **Risultato atteso**:
  - **UI + API (`GET /api/customer/summary`)**: Tutte e 4 le sezioni riflettono in tempo reale lo stato calcolato dal backend, le card corso sono strettamente in sola lettura e le lezioni annullate scompaiono automaticamente una volta superato l'orario di fine previsto della lezione.

---

## 9. Fusi Orari (IANA Timezone) e Ora Legale (DST)

### TC-037: Indipendenza dal Fuso Orario del Dispositivo (`center.timezone` vs Browser Timezone)
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - Sede attiva: `Palestra Centrale` con timezone `Europe/Rome`.
  - Esiste una lezione programmata alle **`18:00`** (ora di Roma, salvata nel DB come `17:00:00.000Z` in inverno CET o `16:00:00.000Z` in estate CEST).
- **Passi operativi**:
  1. Aprire **Chrome DevTools** (`F12`) -> menu `More tools` -> **Sensors**.
  2. Nella sezione **Location**, sovrascrivere il **Timezone ID** del browser impostando `America/New_York` (UTC-5/UTC-4) e successivamente `Asia/Tokyo` (UTC+9).
  3. Ricaricare la pagina `/customer` (come cliente) e la pagina `/worker/calendar` e `/worker/schedules` (come lavoratore).
- **Risultato atteso**:
  - **UI**: Sia su `/customer` sia su `/worker/calendar` e `/worker/schedules`, l'orario della lezione mostrato a schermo resta **sempre `18:00 - 19:00`** (ancorato a `Europe/Rome` tramite `Intl.DateTimeFormat('it-IT', { timeZone: center.timezone })`), ignorando completamente il fuso orario `America/New_York` o `Asia/Tokyo` del dispositivo client.

---

### TC-038: Creazione Ricorrente a Cavallo del Cambio Ora Legale / Ora Solare (DST)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente nella sede `Palestra Centrale` (`Europe/Rome`).
  - Nota: Nel fuso `Europe/Rome`, il passaggio dall'ora solare (CET, `UTC+1`) all'ora legale (CEST, `UTC+2`) avviene l'ultima domenica di marzo (es. **domenica 28 marzo 2027**), mentre il ritorno all'ora solare avviene l'ultima domenica di ottobre (es. **domenica 31 ottobre 2027**).
- **Passi operativi**:
  1. Navigare su `/worker/schedules/new`.
  2. Compilare la creazione ricorrente a cavallo del cambio ora di marzo 2027 (o ottobre 2027):
     - **Corso**: `Yoga Vinyasa`
     - **Data d'inizio**: `2027-03-22` (Lunedì in ora solare CET `UTC+1`)
     - **Data di fine**: `2027-04-05` (Lunedì in ora legale CEST `UTC+2`)
     - **Giorni della settimana**: selezionare `Lunedì`
     - **Ora d'inizio (`Europe/Rome`)**: `18:00`
     - **Durata**: `1` ora, `0` minuti
     - **Posti minimi**: `1`
  3. Cliccare **Salva**.
  4. Navigare su `/worker/calendar` nelle settimane del `22/03/2027`, `29/03/2027` e `05/04/2027` e verificare l'orario mostrato sulle card.
  5. Eseguire una query sul DB D1 locale per ispezionare i valori grezzi salvati nella colonna `schedules.start_date`:
     ```powershell
     npx wrangler d1 execute app-calendario-palestra-db --local --command "SELECT start_date FROM schedules WHERE start_date LIKE '2027-03-%' OR start_date LIKE '2027-04-%' ORDER BY start_date ASC;"
     ```
- **Risultato atteso**:
  - **UI**: In tutte e tre le settimane (`22/03/2027`, `29/03/2027`, `05/04/2027`), la lezione compare a calendario esattamente nello slot delle **`18:00`**.
  - **DB (Verifica conversione DST-aware)**:
    - Lezione del `22/03/2027` (CET `UTC+1`): salvata nel DB come `2027-03-22T17:00:00.000Z`.
    - Lezione del `29/03/2027` (CEST `UTC+2`): salvata nel DB come `2027-03-29T16:00:00.000Z`.
    - Lezione del `05/04/2027` (CEST `UTC+2`): salvata nel DB come `2027-04-05T16:00:00.000Z`.
    Il backend ha calcolato l'offset di `Europe/Rome` sulla data futura specifica di ciascuna lezione anziché usare l'offset odierno.

---

## 10. Validazione Input (Zod Frontend + Backend) e Concorrenza

### TC-039: Validazione Stringhe Vuote o di Soli Spazi (`TRIM` Check)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente.
- **Passi operativi**:
  1. Su `/worker/classes/new`, inserire nel campo **Nome del corso \*** solo spazi bianchi (`"     "`) e cliccare **Salva**.
  2. Su `/worker/users/new`, inserire solo spazi bianchi in **Nome \*** e **Cognome \*** e cliccare **Salva**.
  3. Dalla console browser, inviare una chiamata `POST /api/classes` con `{ "name": "   ", "color": "black", "description": "   " }`.
- **Risultato atteso**:
  - **UI + API**: Sia il frontend sia il backend bloccano l'input con HTTP `400` e i messaggi Zod in italiano:
    - `Il nome del corso non può essere vuoto.`
    - `Il nome non può essere vuoto.` / `Il cognome non può essere vuoto.`
    - `La descrizione non può essere una stringa vuota (usare null se assente).`
  - **DB**: Inoltre, a livello SQLite sono attivi i vincoli `CHECK (LENGTH(TRIM(col)) > 0)` su tutte le colonne testuali e di audit.

---

### TC-040: Validazione Formato Telefono Internazionale `E.164` (`^\+?[0-9]{7,15}$`)
- [ ] **Stato esecuzione**
- **Precondizioni**: Loggato come Gerente su `/worker/users/new` (compilando Nome `Mario`, Cognome `Test`, Email `tel@palestra.it`).
- **Passi operativi**:
  1. Inserire un numero **troppo corto** (< 7 cifre): `+391234` -> cliccare **Salva**.
  2. Inserire un numero **troppo lungo** (> 15 cifre): `+3912345678901234` -> cliccare **Salva**.
  3. Inserire un numero con **spazi interni, trattini o lettere**: `+39 333 1234567` oppure `333-1234567` oppure `+39333ABCDEFG` -> cliccare **Salva**.
  4. Inserire un numero valido con `+` (`+393331234567`) o senza `+` (`393331234567`) -> cliccare **Salva**.
- **Risultato atteso**:
  - **Passi 1, 2, 3**: Bloccati sia in UI sia in API (`400`) con il messaggio: `Il numero di telefono deve rispettare il formato internazionale E.164 (da 7 a 15 cifre, con prefisso + opzionale).` (e protetto a livello DB dal vincolo `CHECK (users_centers_phone_e164)`).
  - **Passo 4**: Salvataggio completato con successo.

---

### TC-041: Doppio Click Rapido e Concorrenza (Anti-Duplicazione e Race Condition sull'Ultimo Posto)
- [ ] **Stato esecuzione**
- **Precondizioni**:
  - Lezione in stato `ENROLLING` con `available_spots = 1`.
  - Cliente 1 (`cliente1@palestra.it`) e Cliente 2 (`cliente2@palestra.it`) con sottoscrizione valida.
- **Passi operativi**:
  1. **Doppio click rapido su "Iscriviti" / "Disiscriviti" / "Salva"**:
     - Come `cliente1@palestra.it` su `/customer`, eseguire un doppio click rapidissimo sul pulsante **Iscriviti** (`[data-testid="course-card-action-btn"]`).
     - Verificare che durante la richiesta il pulsante mostri `Attendere...` e abbia l'attributo `disabled`.
  2. **Doppia richiesta simultanea per lo stesso utente via API**:
     - Dalla console browser di `cliente2@palestra.it`, lanciare in parallelo due richieste identiche di iscrizione alla stessa lezione:
       ```javascript
       await Promise.all([
         fetch('/api/schedules/<id_lezione>/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status),
         fetch('/api/schedules/<id_lezione>/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status),
       ])
       ```
- **Risultato atteso**:
  - **UI (Passo 1)**: Il flag `loading` disabilita immediatamente i pulsanti (`submitting`, `actionScheduleId === item.id`) impedendo invii doppi da interfaccia.
  - **API + DB (Passo 2)**: Una sola richiesta restituisce `200`, mentre l'altra viene respinta con HTTP `409` (`L'utente è già iscritto o in coda per questa lezione.`) grazie al controllo transazionale e al partial unique index `user_schedules_schedule_user_active_idx ON user_schedules(schedule_id, user_id) WHERE deleted_at IS NULL`. Nel DB non esistono mai due righe attive per la stessa coppia `(schedule_id, user_id)`.

---

## 11. Tabella di Sign-off Finale

| Data Sessione | Commit Hash / Tag | Ambiente / Browser / OS | Tester (QA) | Test Eseguiti / Totali | Esito (`PASS` / `FAIL`) | Note e Anomalie Riscontrate |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `____-__-__` | `________` | Chrome Desktop (Windows / macOS) | `________________` | `__ / 41` | `[ ] PASS  [ ] FAIL` | |
| `____-__-__` | `________` | Safari iOS (PWA / Mobile) | `________________` | `__ / 41` | `[ ] PASS  [ ] FAIL` | |
| `____-__-__` | `________` | Chrome Android (PWA / Mobile) | `________________` | `__ / 41` | `[ ] PASS  [ ] FAIL` | |
