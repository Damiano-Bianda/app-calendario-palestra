# 03 - Manuale Funzionale e Utente

**Progetto:** `app-calendario-palestra` (Calendario Palestra)  
**Destinatari:** Cliente Committente, Gerenti di Sede, Vice Gerenti, Istruttori, Utenti Finali  
**Ultimo aggiornamento:** 17/11/2026  
**Referente Funzionale / Cliente:** `[DA COMPLETARE: Nome e contatto del referente funzionale del cliente]`

---

## 1. Specifica "As-Built" per Ruolo Utente

L'applicazione gestisce molteplici sedi (`centers`) e consente a uno stesso account utente (identificato dal proprio indirizzo email) di appartenere a una o più sedi con ruoli specifici per ciascuna sede. Tutti gli orari visualizzati nell'applicazione sono sempre ancorati al **fuso orario della sede fisica selezionata** (es. `Europe/Rome`), indipendentemente dal fuso orario impostato sullo smartphone o sul computer dell'utente.

### 1.1 Riepilogo dei Ruoli e dei Permessi

| Ruolo | Modalità di Default | Rotta di Atterraggio Post-Login | Sintesi delle Funzionalità Abilitate ("As-Built") |
| :--- | :--- | :--- | :--- |
| **Admin** *(Invisibile)* | — | — | Utente tecnico presente esclusivamente nel database (`users`) per firmare la creazione iniziale delle sedi (`centers`) e dei rispettivi Gerenti. Non appartiene a `users_centers` e non compare nelle liste utenti. |
| **Gerente** (`is_manager`) | Lavoratore (`worker`) | `/worker` (Dashboard Lavoratore) | Responsabile unico della sede (non eliminabile e non auto-revocabile). Può creare, modificare ed eliminare **corsi**, **lezioni**, **template di abbonamento**, **sottoscrizioni clienti** e **utenti**. È l'unico ruolo autorizzato a nominare o revocare i **Vice Gerenti**. Può iscrivere/disiscrivere clienti alle lezioni, rigenerare password e inviare email a clienti o iscritti. Può passare in qualsiasi momento alla *Modalità Cliente*. |
| **Vice Gerente** (`is_assistant_manager`) | Lavoratore (`worker`) | `/worker` (Dashboard Lavoratore) | Dispone degli stessi permessi operativi del Gerente nella sede attiva (gestione corsi, lezioni, calendario, abbonamenti, sottoscrizioni, clienti, iscrizioni ed email), con l'unica limitazione di **non poter assegnare o revocare il ruolo di Vice Gerente**. Può passare alla *Modalità Cliente*. |
| **Istruttore** (`is_instructor`) | Lavoratore (`worker`) | `/worker/calendar` (Calendario) | Accede all'area Lavoratore in **sola lettura** (non vede la Dashboard rapida `/worker` né i pulsanti di creazione, modifica o eliminazione). Può consultare il calendario, il dettaglio lezioni (inclusi iscritti e coda), i corsi, gli abbonamenti, le sottoscrizioni e i clienti. **Eccezione operativa:** può inviare email di comunicazione agli iscritti delle lezioni a cui è direttamente assegnato come istruttore. Può passare alla *Modalità Cliente*. |
| **Cliente** *(Nessun flag lavoratore)* | Cliente (`customer`) | `/customer` (Lezioni del giorno) | Visualizza il calendario giornaliero delle lezioni pubblicate dal giorno corrente in avanti (`/customer`), consulta gli abbonamenti richiesti per ciascun corso, si iscrive e si disiscrive autonomamente alle lezioni con iscrizioni aperte (o entra in lista d'attesa se la lezione è al completo) e consulta la propria pagina di **Riepilogo** (`/customer/summary`) con lezioni prenotate, lezioni annullate e stato delle proprie sottoscrizioni. |

---

### 1.2 Elenco Dettagliato delle Funzionalità Implementate

#### A. Autenticazione, Sicurezza e Impostazioni (Tutti i Ruoli)
- **Login (`/login`):** Accesso tramite email e password con reindirizzamento automatico alla pagina predefinita del ruolo nella prima sede attiva.
- **Recupero Password (`/recover`):** Richiesta link di ripristino via email; il link contiene un token crittografato valido per **30 minuti** e utilizzabile una sola volta per scegliere una nuova password (minimo 8 caratteri).
- **Impostazioni (`/settings`):**
  - Visualizzazione del riepilogo profilo (nome, cognome, email, ruolo nella sede attiva, fuso orario sede).
  - **Cambio centro:** selezione da menu a tendina della sede attiva tra quelle a cui l'utente è abilitato.
  - **Cambio password:** aggiornamento della propria password previa verifica della password attuale.
  - **Disconnessione (Logout):** chiusura immediata della sessione corrente.
- **Switch Modalità Lavoratore ⇄ Cliente:** I lavoratori (Gerente, Vice Gerente, Istruttore) dispongono di un pulsante dedicato nella barra laterale (su desktop) o nell'intestazione in alto a destra (su mobile) per passare istantaneamente dalla vista gestionale (`/worker/*`) alla vista cliente (`/customer/*`) e viceversa.

#### B. Area Lavoratore (`/worker/*`) — Gerente, Vice Gerente e Istruttore (Sola Lettura)
1. **Dashboard Lavoratore (`/worker`):** *(Visibile solo a Gerente e Vice Gerente)* Griglia centrale con 4 pulsanti rapidi: *Crea corso*, *Crea lezione*, *Crea abbonamento*, *Crea cliente*.
2. **Gestione Corsi (`/worker/classes`, `/worker/classes/new`, `/worker/classes/[id]`):**
   - Tabella con ricerca testuale, filtro per colore e ordinamento per colonne.
   - Creazione e modifica corso con **Nome** (obbligatorio), **Colore a calendario** (scelta tra 10 colori: Nero, Bianco, Rosso, Blu, Verde, Giallo, Arancione, Viola, Rosa, Ciano; default Nero) e **Descrizione** (facoltativa).
   - **Notifica email su modifica:** se vengono modificati nome o descrizione di un corso che ha lezioni in stato *Iscrizioni aperte* (`ENROLLING`) o *In partenza* (`UPCOMING`) con clienti iscritti, l'interfaccia consente di avvisare via email tutti gli iscritti allegando un messaggio opzionale della direzione.
   - **Blocco eliminazione di sicurezza:** non è possibile eliminare un corso finché esistono lezioni associate in stato `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING` o `ACTIVE`.
3. **Calendario Interattivo (`/worker/calendar`):**
   - **Su Desktop:** vista a griglia **Settimanale** (default) o **Mensile**, selettore data/mese, frecce `< >`, pulsante *Oggi* e pulsante *+ Crea lezione*. Cliccando su uno slot orario vuoto (per Gerente/Vice) si apre la creazione lezione precompilata con quella data e ora; cliccando su una lezione si apre il dettaglio.
   - **Su Mobile:** vista giornaliera a fascia oraria con selettore giorno, frecce `< >` e interazioni identiche al desktop.
4. **Gestione Lezioni (`/worker/schedules`, `/worker/schedules/new`, `/worker/schedules/[id]`):**
   - **Creazione ricorrente settimanale (`/worker/schedules/new`):** selezione corso, data inizio, data fine, giorni della settimana (Lun..Dom), ora di inizio (step 5 min), durata in ore e minuti (step 5 min), posti minimi obbligatori, posti massimi (o illimitati se vuoto), istruttore opzionale, e anticipo in ore/minuti per pubblicazione, apertura iscrizioni e chiusura iscrizioni. Verifica automatica che la chiusura iscrizioni avvenga almeno **5 minuti nel futuro** rispetto al momento della creazione.
   - **Modifica singola lezione (`/worker/schedules/[id]`):** consentita esclusivamente quando la lezione è in stato **Bozza (`DRAFT`)** o **Pubblicata (`PUBLISHED`)**.
   - **Annullamento lezione:** consentito negli stati `DRAFT`, `PUBLISHED`, `ENROLLING` e `UPCOMING`. Imposta la lezione in stato **Annullata dal gerente (`CANCELLED_BY_PROVIDER`)**, riaccredita automaticamente l'entrata agli iscritti e permette di inviare un'email di avviso con messaggio facoltativo.
   - **Gestione Iscritti, Coda e Comunicazioni Email (nella scheda lezione):** visualizzazione in tempo reale della lista iscritti e della coda ordinata cronologicamente; possibilità per Gerente/Vice di iscrivere o disiscrivere manualmente un cliente; pulsante per inviare un'email a tutti gli iscritti (abilitato per Gerente, Vice Gerente e per l'Istruttore titolare della lezione).
5. **Gestione Template Abbonamenti (`/worker/subscriptions`, `/worker/subscriptions/new`, `/worker/subscriptions/[id]`):**
   - Creazione template con nome, descrizione opzionale, numero di entrate (o illimitate se vuoto), durata in giorni (o illimitata se vuoto) e selezione obbligatoria di almeno un corso abilitato.
   - In modifica sono editabili solo **nome** e **descrizione** (i parametri strutturali entrate, durata e corsi abilitati sono in sola lettura).
   - **Blocco eliminazione:** impedisce l'eliminazione se esistono clienti con una sottoscrizione attiva basata su quel template.
6. **Gestione Sottoscrizioni Clienti (`/worker/user-subscriptions` e `/worker/user-subscriptions?user=userId`):**
   - Vista tabellare globale con filtri per cliente/abbonamento e stato validità (*Tutte*, *Solo attive*, *Scadute / Esaurite*).
   - Assegnazione nuova sottoscrizione a un cliente con calcolo automatico della data di scadenza e degli ingressi.
   - Vista dedicata per singolo cliente (`?user=userId`) che consente di modificare la **data di fine** e le **entrate totali**, bloccando il salvataggio se la nuova data di scadenza è antecedente a lezioni già prenotate/in coda o se le entrate totali sono inferiori a quelle già usufruite.
7. **Gestione Clienti e Collaboratori (`/worker/users`, `/worker/users/new`, `/worker/users/[id]`):**
   - Creazione/abilitazione utente nella sede: se l'email non esiste sulla piattaforma, genera un nuovo account con password casuale e invia un'email di benvenuto con le credenziali; se l'email appartiene già a un utente di un'altra sede, lo abilita nella sede corrente e gli invia un'email informativa.
   - Selezione multipla in tabella per inviare comunicazioni email cumulative ai clienti selezionati.
   - Nella scheda utente (`/worker/users/[id]`): modifica anagrafica (nome, cognome, telefono E.164), gestione ruoli (*Istruttore* e, solo per il Gerente, *Vice gerente*), assegnazione rapida abbonamento, pulsante **Reset password** (genera e invia una nuova password via email), invio email singola ed eliminazione dalla sede (protetta da 4 blocchi di sicurezza se è Gerente, ha lezioni attive, sottoscrizioni attive o lezioni assegnate come istruttore).

#### C. Area Cliente (`/customer/*`)
1. **Dashboard Cliente — Lezioni del giorno (`/customer`):**
   - Selettore data posizionato sul giorno corrente, con frecce `< >` per avanzare nei giorni futuri (la navigazione verso i giorni passati è bloccata come da specifica).
   - Elenco giornaliero tramite **Card Corso a 4 righe**:
     - **Riga 1:** a sinistra orario di inizio/fine e durata in minuti; a destra posti liberi (`X posti liberi su Y`, `Posti illimitati` o `Completo`).
     - **Riga 2:** a sinistra pallino colore e nome del corso; a destra badge stato (*Iscrizioni aperte*, *Iscritto*, *Coda (#posizione)*, *Iscritto in partenza*, *Iscrizioni chiuse*, *In corso*, *Annullato per numero minimo non raggiunto*, *Annullato dal gerente*).
     - **Riga 3:** nome e cognome dell'istruttore.
     - **Riga 4:** a sinistra pulsante **Abbonamenti necessari** (apre un popup con i template di abbonamento validi per quel corso); a destra pulsante **Iscriviti** o **Disiscriviti** (visibile quando la lezione è in stato `ENROLLING`).
   - **Selezione intelligente dell'abbonamento e Coda automatica:** quando il cliente clicca *Iscriviti*, il sistema seleziona automaticamente la sottoscrizione attiva idonea che **scade prima** (preferendo quelle a scadenza fissa rispetto a quelle illimitate). Se la lezione è piena, il cliente viene inserito in coda; se un iscritto si disiscrive mentre le iscrizioni sono aperte, il primo cliente in coda viene promosso automaticamente a iscritto effettivo e riceve un'email di conferma.
2. **Riepilogo Cliente (`/customer/summary`):**
   - **Lezioni con iscrizione attiva:** mostra tutte le lezioni in stato `ENROLLING`, `UPCOMING` o `ACTIVE` a cui il cliente è iscritto o in coda (card in sola lettura con data visibile).
   - **Lezioni annullate:** mostra le lezioni a cui il cliente era iscritto che sono state annullate dal gerente o per mancato raggiungimento del numero minimo di iscritti, visibili fino all'orario di fine della lezione.
   - **Sottoscrizioni attive:** mostra le sottoscrizioni valide con periodo di validità, contatore ingressi rimanenti/utilizzati e badge dei corsi inclusi.
   - **Sottoscrizioni scadute:** storico delle sottoscrizioni scadute o con ingressi esauriti.

---

## 2. Guide Operative Passo-Passo

### 2.1 Primo Accesso, Cambio Sede e Cambio Password
1. Aprire il browser all'indirizzo dell'applicazione (verrà mostrata la pagina `/login`).
   `[INSERIRE SCREENSHOT: Schermata di Login (/login) con campi Email, Password e link Recupera password]`
2. Inserire il proprio **Indirizzo email** e la **Password** ricevuta via email e cliccare su **Accedi**.
3. Per cambiare la password temporanea o cambiare la sede attiva:
   - Cliccare sulla voce **Impostazioni** nella barra di navigazione (`/settings`).
   - Nella sezione **Cambio centro**, selezionare la sede desiderata dal menu a tendina e cliccare **Cambia sede**.
   - Nella sezione **Cambio password**, inserire la password attuale, la nuova password (minimo 8 caratteri), confermarla e cliccare **Aggiorna password**.
   `[INSERIRE SCREENSHOT: Pagina Impostazioni (/settings) con sezioni Profilo attuale, Cambio centro, Cambio password e Disconnessione]`

---

### 2.2 Configurazione Iniziale di una Sede (Per Gerente / Vice Gerente)

#### Passo 1: Creare i Corsi
1. Dalla barra laterale (o dalla Dashboard `/worker`), cliccare su **Corsi** (`/worker/classes`) e poi su **+ Crea corso** (`/worker/classes/new`).
2. Inserire il **Nome del corso** (es. *Pilates Reformer*), scegliere il **Colore a calendario** e inserire una **Descrizione** opzionale.
3. Cliccare su **Crea corso**.
   `[INSERIRE SCREENSHOT: Form Creazione Corso (/worker/classes/new) con selettore dei 10 colori]`

#### Passo 2: Creare i Template di Abbonamento
1. Accedere a **Abbonamenti** (`/worker/subscriptions`) e cliccare su **+ Crea abbonamento** (`/worker/subscriptions/new`).
2. Inserire il **Nome dell'abbonamento** (es. *Carnet 10 Ingressi Pilates*).
3. Impostare il **Numero di entrate** (lasciare vuoto per entrate illimitate) e la **Durata in giorni** (lasciare vuoto per durata illimitata).
4. Selezionare con una spunta **almeno un corso abilitato** tra quelli elencati e cliccare su **Crea abbonamento**.
   `[INSERIRE SCREENSHOT: Form Creazione Abbonamento (/worker/subscriptions/new) con selezione corsi abilitati]`

#### Passo 3: Registrare Istruttori e Clienti e Assegnare una Sottoscrizione
1. Accedere a **Clienti** (`/worker/users`) e cliccare su **+ Crea utente** (`/worker/users/new`).
2. Compilare **Nome**, **Cognome**, **Telefono** (in formato internazionale E.164, es. `+393331234567`) ed **Email**.
3. Se la persona è un collaboratore, spuntare **Istruttore** (e/o **Vice gerente**, opzione visibile solo al Gerente). Se non si spunta alcun ruolo, l'utente sarà registrato come **Cliente**.
4. Cliccare su **Crea utente**: il sistema invierà automaticamente l'email di benvenuto con la password temporanea.
5. Per assegnare un abbonamento al cliente:
   - Aprire la scheda del cliente cliccando su **Modifica / Dettagli** in `/worker/users/[id]`.
   - Nella sezione **Sottoscrizioni d'abbonamento del cliente**, cliccare su **+ Aggiungi sottoscrizione**.
   - Scegliere il template di abbonamento, verificare l'anteprima di entrate e scadenza, impostare la **Data d'inizio** e cliccare **Salva sottoscrizione**.
   `[INSERIRE SCREENSHOT: Scheda Dettaglio Utente (/worker/users/[id]) con pulsanti Reset password, Invia email e modale Aggiungi sottoscrizione]`

#### Passo 4: Pianificare le Lezioni a Calendario
1. Accedere a **Calendario** (`/worker/calendar`) o **Lezioni** (`/worker/schedules`) e cliccare su **+ Crea lezione** (`/worker/schedules/new`), oppure cliccare direttamente su una casella vuota del calendario.
   `[INSERIRE SCREENSHOT: Calendario Lavoratore Desktop (/worker/calendar) in vista Settimanale con lezioni colorate]`
2. Selezionare il **Corso**, la **Data d'inizio** e la **Data di fine** del periodo di programmazione, e spuntare i **Giorni della settimana** (es. *Lunedì*, *Mercoledì*, *Venerdì*).
3. Impostare l'**Ora d'inizio**, la **Durata** (in ore e minuti, multipli di 5 min), i **Posti minimi** per confermare la lezione e i **Posti massimi** (lasciare vuoto per posti illimitati).
4. Opzionalmente selezionare l'**Istruttore** e configurare quante ore/minuti prima dell'inizio rendere visibile la lezione, aprire le iscrizioni e chiudere le iscrizioni.
5. Cliccare su **Crea lezioni**: tutte le sessioni del periodo verranno generate in un'unica operazione.
   `[INSERIRE SCREENSHOT: Form Creazione Lezioni Ricorrenti (/worker/schedules/new)]`

---

### 2.3 Prenotazione di una Lezione e Consultazione Riepilogo (Per il Cliente)

1. Effettuare l'accesso: il cliente atterra direttamente su **Lezioni del giorno** (`/customer`).
   `[INSERIRE SCREENSHOT: Dashboard Cliente (/customer) con barra di navigazione data e Card Corso a 4 righe]`
2. Usare le frecce **`<`** e **`>`** o il selettore data per scegliere il giorno desiderato.
3. Su ogni card lezione:
   - È possibile cliccare su **Abbonamenti necessari** (in basso a sinistra) per visualizzare quali abbonamenti danno accesso a quel corso.
   - Se la lezione è in stato **Iscrizioni aperte**, cliccare sul pulsante **Iscriviti** (in basso a destra).
   - Se ci sono posti disponibili, lo stato passa a **Iscritto**; se la lezione ha raggiunto la capienza massima, il cliente viene inserito in lista d'attesa e il badge mostra **Coda (#1)**.
4. Per annullare una prenotazione (o uscire dalla coda) finché le iscrizioni sono aperte, cliccare sul pulsante rosso **Disiscriviti** sulla stessa card: l'entrata verrà immediatamente riaccreditata sull'abbonamento.
5. Cliccando su **Riepilogo** (`/customer/summary`) nella barra di navigazione, il cliente può controllare in ogni momento:
   - L'elenco delle **Lezioni con iscrizione attiva**.
   - Eventuali **Lezioni annullate** dalla palestra o per mancato raggiungimento del numero minimo di iscritti.
   - Le **Sottoscrizioni attive** con il dettaglio degli ingressi residui e della data di scadenza, oltre allo storico delle **Sottoscrizioni scadute**.
   `[INSERIRE SCREENSHOT: Pagina Riepilogo Cliente (/customer/summary) con le 4 sezioni informative]`

---

## 3. Limiti Noti e Debito Tecnico

Dall'analisi statica e architetturale dell'intero codebase (in cui **non sono presenti** commenti `TODO`, `FIXME` o `HACK` lasciati in sospeso), si evidenziano i seguenti aspetti progettuali, limiti noti e possibili evoluzioni future da considerare nella gestione del ciclo di vita del prodotto:

1. **Assenza di Interfaccia Web per il Ruolo `admin` (Multi-Tenant Provisioning):**
   - Come previsto dalla specifica di progetto (*"Admin: utente univoco che può fare tutto e in più creare le sedi e i gerenti. Invisibile a chi utilizza l'app"*), non esiste un'area web di backoffice per creare nuove sedi (`centers`) o nominare il primo Gerente di una nuova sede. Tali operazioni si eseguono a livello infrastrutturale tramite lo script `server/db/seed.ts` o query su Cloudflare D1.
2. **Configurazione Manifest e Service Worker per Installazione PWA:**
   - L'applicazione è progettata con layout mobile-first completo e meta tag `viewport-fit=cover` per dispositivi Android e iOS ([nuxt.config.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/nuxt.config.ts#L24)), ma non include attualmente un file `manifest.webmanifest`, icone dedicate multi-risoluzione o un Service Worker (`@vite-pwa/nuxt`). Se il cliente desidera il banner nativo *"Aggiungi a schermata Home"* con icona personalizzata e funzionamento offline della shell, sarà opportuno aggiungere il manifesto web e le icone del brand.
3. **Invio Email Sincrono durante il Ciclo di Request HTTP:**
   - Le chiamate verso le API di Resend o Brevo ([server/utils/email.ts](file:///c:/Users/Damiano/Progetti%20Visual%20Studio%20Code/app-calendario-palestra/server/utils/email.ts)) vengono effettuate con `await fetch(...)` all'interno dell'handler dell'endpoint senza una coda di background o meccanismo di retry automatico. Se il provider email esterno risponde con un errore HTTP, l'errore viene registrato nei log del Worker (`console.error`) senza far fallire la transazione sul database, ma l'email non viene ritentata automaticamente.
4. **Transizione Silenziosa a `CANCELLED_LOW_ENROLLMENT`:**
   - Poiché lo stato della lezione (`schedules.status`) è calcolato dinamicamente in funzione dell'orario corrente (`now`) e del numero di iscritti (`enrolled_count < minimum_spots` alla chiusura iscrizioni), il passaggio allo stato *Annullato per numero minimo non raggiunto* avviene istantaneamente in modo matematico senza bisogno di un cron job. Di conseguenza, i clienti vedono la lezione nella sezione **Lezioni annullate** della pagina `/customer/summary` e recuperano automaticamente l'ingresso sull'abbonamento, ma non viene inviata un'email push automatica allo scoccare dell'orario di chiusura iscrizioni (a differenza dell'annullamento manuale da parte del Gerente).
5. **Assenza di Rate Limiting Applicativo sulle Rotte Pubbliche:**
   - Gli endpoint `/api/auth/login` e `/api/auth/recover` non implementano un rate-limiter in memoria o su KV all'interno del codice Nitro. Si raccomanda di attivare le regole standard di **Cloudflare WAF / Rate Limiting** direttamente sul dominio Cloudflare di produzione per proteggere `/api/auth/*` da tentativi di brute-force.
