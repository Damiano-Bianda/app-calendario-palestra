# Descrizione progetto

## Nomenclature

* **Sede**: La sede (fitness, yoga, pilates, …) che utilizza l’app
* **Admin**: utente univoco che può fare tutto e in più creare le sedi e i gerenti. Invisibile a chi utilizza l’app
* **Gerente**: Il responsabile della sede, solo una persona può avere questo ruolo
* **Vice gerente**: Ruolo molto simile al gerente ma con qualche limitazione, più persone possono avere questo ruolo
* **Istruttore**: L’istruttore che tiene il corso, più persone possono avere questo ruolo
* **Cliente**: Il cliente della sede, più persone possono avere questo ruolo
* **Utente**: un qualsiasi utente, con un qualsiasi ruolo che interagisce con l’app
* **Corso**: Il corso di gruppo gestito dal Gerente, insegnato dall’istruttore a cui partecipano i clienti
* **Abbonamento**: un abbonamento a illimitato o a entrate per uno o più corsi
* **Lezione**: un’istanza del corso che viene messa a calendario
* **Sottoscrizione d'abbonamento**: L'assegnazione specifica di un template di abbonamento a un singolo cliente, con una propria data di inizio, una data di scadenza e un contatore dedicato delle entrate rimanenti.

---

## Requisiti funzionali

* Il gerente o i vice gerenti possono creare, modificare e eliminare utenti, corsi, abbonamenti, lezioni e sottoscrizioni di abbonamenti.
* Solo il gerente può creare altri vice gerenti.
* Il gerente o i vice gerenti possono contattare i clienti per mail.
* L’istruttore può vedere tutto quello che vedono i (vice) gerenti, ma in sola lettura.
* L’istruttore può contattare gli iscritti al suo corso per mail.
* Il cliente può iscriversi e disiscriversi ai corsi.
* Il gerente è uno solo e non può togliersi il ruolo.
* È necessario un calendario a griglia (settimanale e mensile) con il quale il Gerente e i vice gerenti possono creare, modificare e eliminare lezioni. Gli istruttori lo vedono in sola lettura.
* È necessario un calendario a lista (giornaliera) con il quale i clienti possono iscriversi ai corsi.
* Per gli avvisi email è possibile mettere un messaggio facoltativo.
* La web app per i (vice) gerenti sarà suddivisa nelle sezioni:
  * **Corsi**: Lista con i corsi e la possibilità di gestirli
  * **Calendario**: Griglia mensile / settimanale (browser desktop) o lista giornaliera con orari (mobile app) per gestire lezioni
  * **Abbonamenti**: Lista con gli abbonamenti e la possibilità di gestirli
  * **Clienti**: Lista con gli iscritti e la possibilità di gestirli
* La web app per i clienti sarà suddivisa nelle sezioni:
  * **Lezioni (dashboard)**: lista giornaliera con le lezioni e la possibilità di iscriversi / disiscriversi
  * **Sottoscrizioni**: lista sottoscrizioni d’abbonamento attive
* Entrambe le web app mostrano le opzioni per cambio centro e cambio password.
* Corsi con nome, colore a calendario e descrizione facoltativa.
* Lezioni con creazione ricorrente (settimanale) da data inizio a data fine nei giorni e orari selezionati, orario di pubblicazione e di apertura/chiusura iscrizioni configurabili (in ore e minuti prima dell'inizio), eventuale istruttore, posti massimi (o illimitati) e posti minimi per confermare la lezione alla chiusura delle iscrizioni.
* Abbonamenti con nome, corsi associati, numero di entrate (o illimitate), durata in giorni (o illimitata) ed eventuale descrizione.
* Sottoscrizioni d’abbonamento con data inizio e fine e eventuale aggiunta / rimozione entrate dal (vice) gerente.
* Iscrizione / disiscrizione alle lezioni da parte di cliente o (vice) gerente.
* Coda per iscrizioni ai corsi.
* L’intera applicazione è in italiano.

---

## Requisiti tecnici

* **PWA**
* **Stack**: Nuxt 4, Tailwind CSS, Zod e Drizzle ORM
* **Hosting e DB**: Cloudflare workers + D1 (SQLite)
* **Servizio email**: Resend o Brevo
* **Dominio**: `.com` (per configurare i record DNS (SPF/DKIM) su Resend/Brevo e garantire che le email di benvenuto e le notifiche della coda non vadano mai in spam)
* **Libreria password sicura**
* **Test**
* **Eliminazione soft** con `deleted_at`
* **Gestione della concorrenza** dove necessario
* **Invio email transazionali**
* **Compatibilità**: Android, iOS e browser desktop
* **Validazioni**: frontend e backend
* **Sessione**: senza scadenza o con scadenza molto lunga
* **Tutto il progetto tecnico deve essere in inglese**

---

## Casi d’uso

### Creazione di un corso
1. Il (vice) gerente apre la schermata di creazione
2. Inserisce i dati obbligatori: nome e colore (default nero)
3. Può inserire i dati facoltativi: descrizione
4. Clicca salva
5. Il sistema controlla la presenza dei dati obbligatori:
   * Ne manca almeno uno? Il processo si interrompe
6. Il sistema crea il corso

### Modifica di un corso
1. Il (vice) gerente accede ai dettagli di un corso, modifica i campi e clicca salva
2. Il sistema controlla se ci sono lezioni in stato `ENROLLING` o `UPCOMING` con iscritti e se sta modificando nome e/o descrizione:
   * Sì: chiede al (vice) Gerente se vuole avvisarli, se accetta invia email a tutti
3. Il sistema modifica il corso

### Cancellazione di un corso
1. Il (vice) gerente accede ai dettagli di un corso e clicca elimina
2. Il sistema controlla se ci sono lezioni in stato `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING`, `ACTIVE`:
   * Sì: il sistema avvisa il (vice) gerente che deve prima eliminare tutte le istanze in questi stati e si interrompe
3. Il sistema elimina il corso

### Creazione delle lezioni
1. Il (vice) gerente apre la schermata di creazione
2. Inserisce i dati obbligatori: corso, data d’inizio, data di fine, giorni della settimana, ora d’inizio, durata in ore e minuti, numero di posti minimo. Inserisce i dati facoltativi (se lasciati vuoti valgono `NULL`): istruttore, numero di posti massimo, quante ore e minuti prima rendere visibile la lezione, quante ore e minuti prima aprire le iscrizioni, quante ore e minuti prima chiudere le iscrizioni
3. Il sistema controlla la presenza dei dati obbligatori:
   * Ne manca almeno uno? Il processo si interrompe
4. Il sistema crea le sessioni in base ai dati obbligatori e se `start_date - (registration_close_minutes_before o 0 se null) > now() + 5 minuti`

### Eliminazione di una lezione
1. Il (vice) gerente accede ai dettagli di una lezione e clicca elimina
2. Il sistema controlla se la sessione è in stato `DRAFT`, `PUBLISHED`, `ENROLLING` o `UPCOMING`:
   * No: il processo si interrompe
3. Il sistema controlla se è in stato `PUBLISHED`, `ENROLLING` o `UPCOMING` e se ci sono iscritti:
   * Sì: chiede al Gerente se vuole avvisarli, se accetta invia email a tutti
4. Il sistema elimina la lezione facendo sì che vada in stato `CANCELLED_BY_PROVIDER`

### Modifica di una lezione
1. Il (vice) gerente accede ai dettagli di una lezione, modifica i campi e clicca salva
2. Il sistema controlla se la lezione è in stato `ENROLLING`, `UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED_LOW_ENROLLMENT`, `CANCELLED_BY_PROVIDER`:
   * Sì: il processo si interrompe
3. Il sistema salva le modifiche

### Creazione di un utente
1. Il (vice) gerente apre la schermata di creazione utente.
2. Inserisce i dati obbligatori: nome, cognome, numero di telefono ed email.
3. Spunta gli eventuali ruoli aggiuntivi della sede (`is_instructor` e, solo se a operare è il gerente, `is_assistant_manager`). Se non viene spuntato alcun ruolo, l'utente è considerato esclusivamente un cliente.
4. Clicca salva.
5. Il sistema controlla la presenza dei dati obbligatori:
   * Ne manca almeno uno? Il processo si interrompe
6. Il sistema verifica se esiste già una riga attiva (`deleted_at IS NULL`) nella tabella `users_centers` per questa sede (`center_id`) associata a quell'indirizzo email:
   * Esiste già nella sede? Sì, il processo si interrompe.
7. Il sistema verifica se l'email esiste già come account attivo (`deleted_at IS NULL`) nella tabella globale `users`:
   * **Non esiste**:
     * Il sistema genera una password casuale sicura e crea la riga in `users`.
     * Crea una nuova riga in `users_centers` associando `user_id` e `center_id`.
     * Invia un'email all'utente con le credenziali di primo accesso.
   * **Esiste** (utente già registrato sulla piattaforma presso un'altra sede):
     * Il sistema crea una nuova riga in `users_centers` associando il `user_id` esistente al `center_id` corrente.
     * Invia un'email informativa all'utente avvisandolo che è stato abilitato nella nuova sede e può accedervi con le proprie credenziali abituali.

### Modifica anagrafica di un utente
1. Il (vice) gerente apre la schermata di modifica
2. Modifica nome, cognome e/o numero di telefono
3. Clicca salva
4. Il sistema controlla la presenza dei dati obbligatori:
   * Ne manca almeno uno? Il processo si interrompe
5. Il sistema salva le modifiche

### Modifica ruolo di un utente
1. Il (vice) gerente apre la schermata di modifica
2. Modifica le flag vice gerente e/o istruttore
3. Clicca salva
4. Il sistema controlla se all'utente viene rimosso il ruolo di istruttore mentre ha lezioni assegnate in stato `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING` o `ACTIVE`:
   * Sì: il processo si interrompe
5. Il sistema salva le modifiche

### Eliminazione di un utente
1. Il (vice) gerente apre la schermata di dettaglio dell’utente e clicca elimina
2. Il sistema controlla se l’utente è iscritto a lezioni attive (`ENROLLING`, `UPCOMING`, `ACTIVE`) o se ha sottoscrizioni d’abbonamento attive (non scadute e con entrate disponibili):
   * Sì: il processo si interrompe
3. Il sistema controlla se l’utente è un istruttore e ha lezioni assegnate in stato `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING` o `ACTIVE`:
   * Sì: il processo si interrompe
4. Il sistema elimina l’utente

### Creazione di un abbonamento
1. Il (vice) gerente apre la schermata di creazione abbonamento.
2. Inserisce i dati obbligatori e seleziona almeno un corso abilitato.
3. Inserisce il dato facoltativo: descrizione.
4. Clicca salva.
5. Il sistema controlla la presenza dei dati obbligatori e che sia stato selezionato almeno un corso:
   * Ne manca almeno uno? Il processo si interrompe.
6. Il sistema crea l’abbonamento con i corsi associati.

### Modifica di un abbonamento
1. Il (vice) gerente apre la pagina di modifica di un abbonamento.
2. Modifica il nome e/o la descrizione (i campi strutturali come entrate, durata e corsi abilitati sono in sola lettura).
3. Clicca salva.
4. Il sistema controlla la presenza dei dati obbligatori:
   * Ne manca almeno uno? Il processo si interrompe
5. Il sistema modifica l'abbonamento.

### Eliminazione di un abbonamento
1. Il (vice) gerente accede ai dettagli dell'abbonamento e clicca elimina.
2. Il sistema controlla se ci sono utenti con l’abbonamento attivo:
   * Sì: il processo si interrompe
3. Il sistema elimina l’abbonamento

### Assegnazione di una sottoscrizione d'abbonamento a un utente
1. Il (vice) gerente apre la pagina di dettaglio dell’utente e sceglie un abbonamento
2. Il sistema pre-compila i campi
3. Il (vice) gerente può modificare la data d’inizio e salvare
4. Il sistema salva la sottoscrizione d'abbonamento

### Modifica di una sottoscrizione d'abbonamento a un utente
1. Il (vice) gerente apre la pagina di dettaglio dell’utente e clicca sulla sottoscrizione di abbonamento
2. Il (vice) gerente modifica la data di fine e/o le entrate totali e clicca salva
3. Il sistema controlla se la nuova data di fine è antecedente a lezioni a cui l'utente è già iscritto o in coda con quella sottoscrizione, oppure se il nuovo numero di entrate totali è inferiore alle entrate già utilizzate:
   * Sì: il processo si interrompe
4. Il sistema modifica l’abbonamento

### Cliente si iscrive / Gerente iscrive cliente a una lezione
1. Il cliente o il (vice) gerente apre la pagina della lezione e clicca iscriviti (il (vice) gerente deve scegliere il nuovo cliente)
2. Il sistema esegue in una transazione atomica:
   * Il sistema controlla se la lezione è in stato `ENROLLING` e se il cliente non sia già iscritto:
     * No: il processo si interrompe
   * Il sistema controlla se ha una sottoscrizione d’abbonamento attiva per il corso con almeno un’entrata rimanente (e valida nella data della lezione) (se l’utente ha più di una sottoscrizione idonea per il corso usa quella che scade prima):
     * No: il processo si interrompe
   * Il sistema controlla se il corso è pieno:
     * Sì: il sistema mette il cliente in coda
     * No: il sistema iscrive il cliente
   * Se il cliente è stato iscritto dal (vice) gerente viene avvisato con un'email

### Cliente si disiscrive / Gerente disiscrive cliente da una lezione / coda
1. Il cliente o il (vice) gerente apre la pagina della lezione con iscrizioni aperte e clicca disiscriviti (il (vice) gerente deve scegliere il cliente dalla lezione)
2. Il sistema esegue in una transazione atomica:
   * Il sistema controlla se la lezione è in stato `ENROLLING`:
     * No: il processo si interrompe
   * Il sistema disiscrive il cliente (eliminando soft la riga in `user_schedules`, il che restituisce automaticamente l'entrata alla sottoscrizione d'abbonamento)
   * Se il cliente disiscritto non era in coda (`is_queued = FALSE`), il sistema controlla se ci sono iscrizioni in coda per quella lezione:
     * Sì: il sistema promuove l'iscrizione in coda più vecchia (impostando `is_queued = FALSE`) e invia un'email di conferma al cliente promosso

### Recupero password di un utente
1. L'utente clicca su "Password dimenticata" nella schermata di login e inserisce la propria email.
2. Se l'email esiste, il sistema genera un token temporaneo crittografato (scadenza 30 minuti) e invia un link via email.
3. L'utente apre il link, inserisce la nuova password e il sistema aggiorna `password_hash` in `users`.

---

## Database

### Direttive
* Ogni data è una stringa in formato UTC ISO 8601 `yyyy-mm-ddThh:mm:ss.sssZ`
* L’applicazione è multi-centro e multi-utente quindi serve una gestione della concorrenza rigorosa
* La cancellazione di ogni riga è soft quindi non ci sono direttive `delete on cascade`
* Tutti i vincoli sul database e quelli sul backend sono da replicare nel frontend
* Il formato data è ISO 8601, ricavabile in javascript con `new Date().toISOString()`
* Le date nel database sono salvate in UTC e vengono mostrate usando `centers.timezone` tramite la funzione `Intl.DateTimeFormat`

### Campi tecnici su tutte le tabelle

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `created_by` | CHAR(36) | Foreign key (`users`) | UUIDv7 |
| `updated_by` | CHAR(36) | Foreign key (`users`) | UUIDv7 |
| `created_at` | CHAR(24) | Not null, not empty | Data, default `now()` |
| `updated_at` | CHAR(24) | Not null, not empty | Data, default `now()` |
| `deleted_at` | CHAR(24) | Not empty | Data, default `NULL` |

### Note
* Una colonna di tipo `char`, `varchar` o `text` col vincolo `not empty` significa `CONSTRAINT not_empty CHECK (LENGTH(TRIM(nome_colonna)) > 0)`
* Il tipo di dati nella documentazione è standard SQL, ma va adattato al database, in questo caso SQLite

### Note sulle date per gestire fusi orari e calendari corsi
* **Database (SQLite)**:
  * `sedi (centers)`: memorizzare la colonna `timezone` con l'identificativo geografico IANA (es. `'Europe/Rome'`). Non usare mai offset numerici fissi come `+01:00`
  * `Lezioni (schedules)`: salvare data e ora di inizio/fine sempre normalizzate in formato UTC ISO 8601 (es. `2026-11-10T17:00:00.000Z`) con tipo `CHAR(24)`.
* **Backend (Scrittura / Creazione evento)**:
  * Il (vice) Gerente seleziona giorno e ora locale della palestra (es. "18:00" a Ospedaletti).
  * **Regola di conversione**: convertire l'orario locale in UTC calcolando l'offset della zona IANA sulla data specifica futura della lezione, non su quella odierna. Questo previene discrepanze dovute al passaggio tra ora solare e ora legale (DST).
  * Salvare nel database il timestamp risultante in UTC.
* **Frontend (Lettura / Visualizzazione utente)**:
  * **Regola UX**: mostrare sempre l'orario ancorato al fuso della sede fisica, ignorando l'orologio del dispositivo del cliente (se un utente si trova a New York o Tokyo e prenota a Milano, deve leggere "18:00", non l'orario del proprio smartphone).
  * **Formattazione**: trasformare la stringa UTC a schermo tramite `Intl.DateTimeFormat`, passando esplicitamente l'opzione `{ timeZone: center.timezone }`.

---

### Tabelle principali

#### Tabella `centers` (sedi)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `name` | VARCHAR(255) | Not null, not empty | |
| `timezone` | TEXT | Not null, not empty | |

`created_by` è sempre la primary key di `admin` (nella tabella `users`, per la riga dell'utente `admin` iniziale, `created_by` e `updated_by` puntano al proprio stesso `id`).

#### Tabella `users` (Utenti)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `email` | VARCHAR(255) | Not null, not empty, unique | Formato email, usare un unique partial index su `users(email) (WHERE deleted_at IS NULL)` |
| `password_hash` | VARCHAR(255) | Not null | Hash Bcrypt/Argon2 |

#### Tabella `users_centers` (per utenti multisede)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `center_id` | CHAR(36) | Foreign key (`centers`) | UUIDv7, usare un unique partial index su `users_centers(center_id, user_id) (WHERE deleted_at IS NULL)` |
| `user_id` | CHAR(36) | Foreign key (`users`) | UUIDv7, vedi indice parziale con `center_id` |
| `name` | VARCHAR(255) | Not null, not empty | |
| `surname` | VARCHAR(255) | Not null, not empty | |
| `phone_number` | VARCHAR(20) | Not null, not empty | Formato che usa lo standard internazionale E.164: `^\+?[0-9]{7,15}$` seguito da 7-15 cifre |
| `is_manager` | BOOLEAN | Not null | Default `FALSE` |
| `is_assistant_manager` | BOOLEAN | Not null | Default `FALSE` |
| `is_instructor` | BOOLEAN | Not null | Default `FALSE` |

#### Tabella `classes` (Corsi)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `center_id` | CHAR(36) | Foreign key (`centers`) | UUIDv7 |
| `name` | VARCHAR(255) | Not null, not empty | |
| `description` | VARCHAR(1000) | Nullable, Not empty | |
| `color` | TEXT | Not null, not empty, `classes_color` | `CONSTRAINT classes_colors CHECK (color IN ('black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'cyan'))` Default `BLACK` |

#### Tabella `schedules` (lezione)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `class_id` | CHAR(36) | Foreign key (`classes`) | UUIDv7 |
| `center_id` | CHAR(36) | Foreign key (`centers`) | UUIDv7 |
| `instructor_id` | CHAR(36) | Nullable, Foreign key (`users`) | UUIDv7 |
| `start_date` | CHAR(24) | Not null, not empty | Formato data, Step: 5 min |
| `duration_minutes` | INTEGER | Not null, `[5, N]` | Step: 5 min |
| `available_spots` | INTEGER | `NULL` o `available_spots >= minimum_spots` | `NULL`: posti illimitati |
| `minimum_spots` | INTEGER | `[1, N]` | |
| `publication_minutes_before` | INTEGER | `NULL` o `[1, N]` | Step: 5 min, `NULL`: subito visibile |
| `registration_open_minutes_before` | INTEGER | `NULL` o `[1, N]` | Step: 5 min, `NULL`: subito iscrivibile |
| `registration_close_minutes_before` | INTEGER | `NULL` o `[1, N]` | `NULL`: iscrivibile fino a `start_date` |

Gli iscritti effettivi (`enrolled_count`) vengono calcolati contando le righe della tabella `user_schedules` con `deleted_at IS NULL` e `is_queued = FALSE`. I posti rimanenti (`remaining_spots`) sono dati da `available_spots - enrolled_count` (oppure `NULL` se `available_spots` è `NULL`).

Lo stato della lezione (`status`) viene calcolato coi dati disponibili (gli stati da `DRAFT` a `CANCELLED_LOW_ENROLLMENT` valgono solo se `schedules.deleted_at IS NULL`, e quando un campo minuti è `NULL` nella formula vale `created_at` per `publication`/`registration_open` e `0` per `registration_close`):

| Nome | Descrizione | Condizione |
| :--- | :--- | :--- |
| `DRAFT` | Lezione a calendario non visibile ai clienti | `created_at <= now < start_date - date(publication_minutes_before)` |
| `PUBLISHED` | Lezione a calendario visibile ai clienti | `start_date - date(publication_minutes_before) <= now < start_date - date(registration_open_minutes_before)` |
| `ENROLLING` | Lezione con iscrizioni aperte | `start_date - date(registration_open_minutes_before) <= now < start_date - date(registration_close_minutes_before)` |
| `UPCOMING` | Lezione in partenza | `start_date - date(registration_close_minutes_before) <= now < start_date && (enrolled_count >= minimum_spots)` |
| `ACTIVE` | Lezione in corso | `start_date <= now < start_date + date(duration_minutes) && (enrolled_count >= minimum_spots)` |
| `COMPLETED` | Lezione terminata | `(now >= start_date + date(duration_minutes)) && (enrolled_count >= minimum_spots)` |
| `CANCELLED_LOW_ENROLLMENT` | Lezione cancellata per mancanza d’iscritti | `(start_date - date(registration_close_minutes_before)) <= now && (enrolled_count < minimum_spots)` |
| `CANCELLED_BY_PROVIDER` | (Vice) Gerente cancella la lezione | `schedules.deleted_at IS NOT NULL` |

**Altri vincoli sulla tabella**:
* In creazione deve valere `start_date - (registration_close_minutes_before o 0 se null) > now() + 5 minuti`
* `start_date + date(duration_minutes) > start_date >= (start_date - date(registration_close_minutes_before) o start_date se null) >= (start_date - date(registration_open_minutes_before) o created_at se null) >= (start_date - date(publication_minutes_before) o created_at se null) >= created_at`

#### Tabella `user_schedules` (Iscrizioni alle lezioni)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `center_id` | CHAR(36) | Foreign key (`centers`) | UUIDv7 |
| `user_id` | CHAR(36) | Foreign key (`users`) | UUIDv7, usare un unique partial index su `user_schedules(schedule_id, user_id) (WHERE deleted_at IS NULL)` |
| `schedule_id` | CHAR(36) | Foreign key (`schedules`) | UUIDv7, vedi indice parziale con `user_id` |
| `user_subscription_id` | CHAR(36) | Foreign key (`users_subscriptions`) | UUIDv7 |
| `is_queued` | BOOLEAN | Not null | Default `FALSE` |

#### Tabella `subscriptions` (Abbonamenti)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `center_id` | CHAR(36) | Foreign key (`centers`) | UUIDv7 |
| `name` | VARCHAR(255) | Not null, not empty | |
| `description` | VARCHAR(1000) | Nullable, Not empty | |
| `entrances` | INTEGER | `NULL` o `[1, N]` | `NULL`: entrate illimitate |
| `duration_days` | INTEGER | `NULL` o `[1, N]` | `NULL`: durata illimitata |

#### Tabella `users_subscriptions` (sottoscrizione d'abbonamento)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `subscription_id` | CHAR(36) | Foreign key (`subscriptions`) | UUIDv7 |
| `center_id` | CHAR(36) | Foreign key (`centers`) | UUIDv7 |
| `user_id` | CHAR(36) | Foreign key (`users`) | UUIDv7 |
| `start_date` | CHAR(24) | Not null, not empty | Formato data |
| `end_date` | CHAR(24) | `NULL` o `> start_date` | Formato data, `NULL`: illimitato |
| `entrances` | INTEGER | `NULL` o `[1, N]` | `NULL`: illimitate |

Le entrate rimanenti (`remaining_entrances`) vengono calcolate sottraendo da `entrances` il numero di righe con `deleted_at IS NULL` nella tabella `user_schedules` associate a `user_subscription_id`, escludendo le lezioni in stato `CANCELLED_BY_PROVIDER` o `CANCELLED_LOW_ENROLLMENT` e le righe con `is_queued = TRUE` la cui lezione non è più in stato `ENROLLING`.

#### Tabella `subscriptions_classes` (Corsi dell’abbonamento)

| Campo | Tipo | Vincoli | Note |
| :--- | :--- | :--- | :--- |
| `id` | CHAR(36) | Primary key | UUIDv7 |
| `subscription_id` | CHAR(36) | Foreign key (`subscriptions`) | UUIDv7 |
| `class_id` | CHAR(36) | Foreign key (`classes`) | UUIDv7 |

---

## GUI e routing

| Pagina o componente | Visualizzazione desktop | Visualizzazione mobile | Destinata a | Route | Modalità | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dashboard lavoratore** | Griglia centrale con quattro grandi pulsanti: crea corso, crea lezione, crea abbonamento, crea cliente | Uguale a desktop | Istruttori e (vice) gerenti | `/worker` | Lavoratore | Per gli istruttori non compare il pulsante Dashboard |
| **Navbar lavoratore** | Verticale sul lato sinistro con un toggle button per passare da modalità lavoratore a modalità cliente, un bottone calendario, uno clienti, uno corsi, uno lezioni, uno abbonamenti, uno sottoscrizioni e uno impostazioni | Orizzontale in fondo. Il toggle button per cambio modalità si trova in alto a destra dello schermo | Istruttori e (vice) gerenti | - | Lavoratore | Sempre presente. Il bottone logout |
| **Dashboard cliente** | Lista giornaliera dei corsi con data in alto, pulsanti `< >` per cambiare giorno | Uguale a desktop | Clienti | `/customer` | Cliente | Di default si apre sul giorno corrente. Non si può andare ai giorni precedenti |
| **Navbar cliente** | Verticale sul lato sinistro con un toggle button per passare da modalità cliente a modalità lavoratore, un bottone lezioni, uno riepilogo e uno impostazioni | Orizzontale in fondo. Il toggle button per cambio modalità si trova in alto a destra dello schermo | Clienti | - | Cliente | Sempre presente. Il toggle button per cambiare modalità solo se il cliente è anche un lavoratore |
| **Card corsi utente** | Quattro righe: A sinistra ora e durata e a destra X posti liberi su Y o label completo; A sinistra nome corso e a destra label stato; A sinistra nome istruttore; A sinistra popup che al click mostra abbonamenti necessari, a destra pulsante con label iscriviti o disiscriviti | Uguale a desktop | Clienti | - | Cliente | Label stato può essere iscrizioni aperte, iscritto o coda (se iscritto durante iscrizioni aperte), iscritto in partenza, iscrizioni chiuse se non iscritto, in corso, annullato per numero minimo non raggiunto e annullato dal gerente |
| **Riepilogo** | Lista corsi con iscrizione attiva (stato `ENROLLING`, `UPCOMING` o `ACTIVE`), lista corsi annullati per posti o da (vice) gerente fino a data e ora di fine e lista sottoscrizioni attive e lista sottoscrizioni scadute | Uguale a desktop | Clienti | `/customer/summary` | Cliente | Per i corsi usare la card corsi ma in sola lettura |
| **Corsi** | Lista corsi con pulsanti per gestire modifica e eliminazione. Pulsante per creare corso | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/classes` | Lavoratore | Ordinamento e filtro righe in base a colonne. Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Gestione corso** | Stesso form per creare o modificare corso. In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/classes/new`, `/worker/classes/[id]` | Lavoratore | Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Calendario** | Barra superiore: toggle vista (Mensile / Settimanale), selettore data (mese/anno per mensile) e frecce (`< >`) per cambiare mese/settimana e pulsante "+ Crea lezione". Corpo centrale: griglia calendario con le lezioni colorate in base al corso. Interazioni (solo per gerente e vice gerente): click su uno slot vuoto per creare una lezione in quella data/ora; click su una lezione esistente per aprirne il dettaglio/modifica. | Barra superiore: selettore giorno (giorno/mese/anno) con frecce (`< >`) e pulsante "+ Crea lezione". Corpo centrale: griglia oraria giornaliera con le lezioni. Interazioni: uguali a desktop. | Istruttori e (vice) gerenti | `/worker/calendar` | Lavoratore | All’inizio posizionamento automatico su giorno, settimana o mese corrente. Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare. Di default vista settimanale per desktop |
| **Gestione lezione** | Stesso form per creare o modificare lezione. In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma | Uguale a desktop | Istruttori e (vice) gerente | `/worker/schedules/new`, `/worker/schedules/[id]` | Lavoratore | Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare. In visualizzazione/modifica mostra anche la lista degli iscritti e della coda (con pulsanti per iscrivere / disiscrivere clienti per il gerente e pulsante per inviare email agli iscritti con messaggio facoltativo) |
| **Abbonamenti** | Lista abbonamenti con pulsanti per gestire modifica e eliminazione. Pulsante per creare abbonamento | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/subscriptions` | Lavoratore | Ordinamento e filtro righe in base a colonne. Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Gestione abbonamento** | Stesso form per creare o modificare abbonamento. In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/subscriptions/new`, `/worker/subscriptions/[id]` | Lavoratore | Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Clienti** | Lista utenti con pulsanti per gestire modifica e eliminazione. Pulsante per creare utente e pulsante per inviare email ai clienti selezionati | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/users` | Lavoratore | Ordinamento e filtro righe in base a colonne. Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Gestione cliente** | Stesso form per creare o modificare cliente. In caso di modifica pulsante in alto a destra per eliminarlo con popup di conferma, pulsante per aggiungere sottoscrizione e per resettare password, e pulsante per inviare un'email al cliente | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/users/new`, `/worker/users/[id]` | Lavoratore | Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Lezioni** | Lista lezioni con pulsanti per gestire modifica e eliminazione. Pulsante per creare lezione | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/schedules` | Lavoratore | Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Sottoscrizioni** | Lista sottoscrizioni d’abbonamento con pulsanti per gestire modifica e eliminazione | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/user-subscriptions` | Lavoratore | Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Gestione sottoscrizione** | Mostra tutte le sottoscrizioni dell’utente con campi per modificare le entrate e la data di fine | Uguale a desktop | Istruttori e (vice) gerenti | `/worker/user-subscriptions?user=userId` | Lavoratore | Istruttori vedono in sola lettura: niente pulsanti per creare, modificare e eliminare |
| **Impostazioni** | Tendina per cambio centro che mostra quelli a cui è iscritto, campo cambio password, un pulsante logout | Uguale a desktop | Clienti, istruttori e (vice) gerenti | `/settings` | Lavoratore e Cliente | |
| **Login** | Campi email, password e bottone recupero password | Uguale a desktop | Clienti, istruttori e (vice) gerenti | `/login` | Lavoratore e Cliente | Il (vice) gerente accede di default su `/worker`, l'istruttore accede di default su `/worker/calendar` |
| **Recupero password** | Campo email per richiedere il link di reset; aprendo il link con token valido mostra il campo per inserire la nuova password | Uguale a desktop | Clienti, istruttori e (vice) gerenti | `/recover` | Lavoratore e Cliente | |

---

## API

### Direttive generali API
* **Architettura**: Tutte le API sono implementate tramite Nitro Server Routes di Nuxt 4 sotto il prefisso `/api/` ed eseguite su Cloudflare Workers con database D1.
* **Sessione e Multi-sede**: La sessione a lunga scadenza (cookie HTTP-only) contiene `user_id` e il `center_id` attivo selezionato dall'utente.
* **Controllo accessi (Middleware)**: Ogni endpoint (esclusi login e recupero password) verifica che l'utente sia autenticato e abbia una riga con `deleted_at` nullo in `users_centers` per il `center_id` attivo.
* **Validazione e Fusi Orari**: Tutti i dati in ingresso sono validati con schemi Zod condivisi tra frontend e backend. Tutte le date sono ricevute, validate e salvate in formato UTC ISO 8601.
* **Audit e Soft Delete**: Le API di creazione e modifica aggiornano automaticamente `created_by`, `updated_by`, `created_at` e `updated_at`. Le API `DELETE` non eseguono mai cancellazioni fisiche ma impostano `deleted_at`.
* **Concorrenza**: Le scritture che coinvolgono più tabelle o controlli di capienza/entrate (iscrizioni, disiscrizioni, coda, creazione lezioni ricorrenti) devono usare transazioni o batch atomici di D1.

### 1. Autenticazione e Impostazioni

| Metodo | Endpoint | Permessi | Scopo |
| :--- | :--- | :--- | :--- |
| POST | `/api/auth/login` | Pubblico | Login utente |
| POST | `/api/auth/logout` | Autenticato | Logout utente |
| GET | `/api/auth/me` | Autenticato | Dati sessione e sedi |
| POST | `/api/auth/recover` | Pubblico | Richiesta link reset |
| POST | `/api/auth/reset-password` | Pubblico | Impostazione nuova password |
| PUT | `/api/settings/center` | Autenticato | Cambio sede attiva |
| PUT | `/api/settings/password` | Autenticato | Cambio password personale |

* **POST `/api/auth/login`**: Verifica email e password in `users` e restituisce la sessione impostando la prima sede attiva di `users_centers` e la modalità di default (lavoratore per gerenti/istruttori, cliente per gli altri).
* **GET `/api/auth/me`**: Restituisce il profilo dell'utente, la lista delle sedi a cui appartiene (con i relativi `timezone`) e i ruoli (`is_manager`, `is_assistant_manager`, `is_instructor`) nella sede attiva.
* **POST `/api/auth/recover`**: Riceve l'email; se esiste in `users`, genera un token crittografato stateless (validità 30 minuti) e invia via email il link di recupero.
* **POST `/api/auth/reset-password`**: Riceve il token e la nuova password, verifica la firma e la scadenza del token e aggiorna `password_hash` in `users`.
* **PUT `/api/settings/center`**: Aggiorna il `center_id` attivo nella sessione dopo aver verificato l'appartenenza dell'utente in `users_centers`.
* **PUT `/api/settings/password`**: Verifica la password attuale dell'utente loggato e aggiorna `password_hash` in `users`.

### 2. Corsi (Classes)

| Metodo | Endpoint | Permessi | Scopo |
| :--- | :--- | :--- | :--- |
| GET | `/api/classes` | Tutti i ruoli | Lista corsi della sede |
| GET | `/api/classes/:id` | Lavoratori | Dettaglio singolo corso |
| POST | `/api/classes` | (Vice) Gerente | Creazione corso |
| PUT | `/api/classes/:id` | (Vice) Gerente | Modifica corso |
| DELETE | `/api/classes/:id` | (Vice) Gerente | Eliminazione soft corso |

* **GET `/api/classes`**: Restituisce i corsi attivi della sede corrente con supporto a ordinamento e filtro per le tabelle lavoratore.
* **POST `/api/classes`**: Valida nome (obbligatorio), colore (default `black`) e descrizione (facoltativa) e crea la riga in `classes`.
* **PUT `/api/classes/:id`**: Aggiorna il corso; se cambiano nome o descrizione e il body include il flag di notifica (più eventuale messaggio facoltativo), invia un'email agli iscritti delle lezioni in stato `ENROLLING` o `UPCOMING`.
* **DELETE `/api/classes/:id`**: Verifica che non esistano lezioni associate in stato `DRAFT`, `PUBLISHED`, `ENROLLING`, `UPCOMING` o `ACTIVE`; se esistono restituisce errore 409, altrimenti imposta `deleted_at`.

### 3. Lezioni e Iscrizioni (Schedules)

| Metodo | Endpoint | Permessi | Scopo |
| :--- | :--- | :--- | :--- |
| GET | `/api/schedules` | Tutti i ruoli | Lista lezioni per calendario/lista |
| GET | `/api/schedules/:id` | Tutti i ruoli | Dettaglio lezione e iscritti |
| POST | `/api/schedules` | (Vice) Gerente | Creazione ricorrente lezioni |
| PUT | `/api/schedules/:id` | (Vice) Gerente | Modifica singola lezione |
| DELETE | `/api/schedules/:id` | (Vice) Gerente | Annullamento lezione |
| POST | `/api/schedules/:id/enroll` | Cliente, (Vice) Gerente | Iscrizione a lezione o coda |
| DELETE | `/api/schedules/:id/enroll/:userId` | Cliente, (Vice) Gerente | Disiscrizione da lezione o coda |
| POST | `/api/schedules/:id/email` | Lavoratori | Email agli iscritti della lezione |

* **GET `/api/schedules`**: Filtra per intervallo di date (giorno, settimana, mese); per i clienti esclude le lezioni in stato `DRAFT` e calcola per ogni lezione `remaining_spots`, `status` e lo stato d'iscrizione dell'utente.
* **GET `/api/schedules/:id`**: Restituisce i dati della lezione; per (vice) gerenti e istruttori include la lista degli utenti iscritti e in coda con i relativi contatti.
* **POST `/api/schedules`**: Genera le istanze ricorrenti tra data inizio e data fine nei giorni/orari scelti (convertiti in UTC secondo il `timezone` della sede) verificando i vincoli temporali e il margine di 5 minuti da `now()`.
* **PUT `/api/schedules/:id`**: Permette la modifica solo se la lezione è in stato `DRAFT` o `PUBLISHED`; in caso contrario restituisce errore 409.
* **DELETE `/api/schedules/:id`**: Consentito solo in stato `DRAFT`, `PUBLISHED`, `ENROLLING` o `UPCOMING`; imposta `deleted_at` (portando lo stato a `CANCELLED_BY_PROVIDER`) e, se richiesto, invia email con messaggio facoltativo agli iscritti.
* **POST `/api/schedules/:id/enroll`**: Verifica stato `ENROLLING`, assenza di doppia iscrizione e presenza di sottoscrizione valida con entrate; inserisce in `user_schedules` (con `is_queued = true` se pieno) e avvisa via email se iscritto dal gerente.
* **DELETE `/api/schedules/:id/enroll/:userId`**: Verifica stato `ENROLLING`; imposta `deleted_at` su `user_schedules` e, se il posto liberato non era in coda, promuove il primo utente in coda (`is_queued = false`) inviandogli un'email.
* **POST `/api/schedules/:id/email`**: Permette al (vice) gerente o all'istruttore assegnato a quella lezione di inviare un'email con testo personalizzato a tutti gli iscritti della lezione.

### 4. Abbonamenti (Subscriptions)

| Metodo | Endpoint | Permessi | Scopo |
| :--- | :--- | :--- | :--- |
| GET | `/api/subscriptions` | Lavoratori | Lista template abbonamenti |
| GET | `/api/subscriptions/:id` | Lavoratori | Dettaglio abbonamento e corsi |
| POST | `/api/subscriptions` | (Vice) Gerente | Creazione abbonamento |
| PUT | `/api/subscriptions/:id` | (Vice) Gerente | Modifica nome e descrizione |
| DELETE | `/api/subscriptions/:id` | (Vice) Gerente | Eliminazione abbonamento |

* **POST `/api/subscriptions`**: Valida i campi obbligatori e la presenza di almeno un `class_id`, creando in transazione la riga in `subscriptions` e le associazioni in `subscriptions_classes`.
* **PUT `/api/subscriptions/:id`**: Aggiorna esclusivamente i campi `name` e `description`, ignorando qualsiasi modifica a entrate, durata o corsi associati.
* **DELETE `/api/subscriptions/:id`**: Controlla se esistono sottoscrizioni attive in `users_subscriptions` per questo abbonamento; se presenti blocca il processo con errore 409, altrimenti imposta `deleted_at`.

### 5. Sottoscrizioni d'abbonamento (User Subscriptions)

| Metodo | Endpoint | Permessi | Scopo |
| :--- | :--- | :--- | :--- |
| GET | `/api/user-subscriptions` | Tutti i ruoli | Lista sottoscrizioni (filtrabile) |
| POST | `/api/user-subscriptions` | (Vice) Gerente | Assegnazione abbonamento a cliente |
| PUT | `/api/user-subscriptions/:id` | (Vice) Gerente | Modifica scadenza ed entrate |
| DELETE | `/api/user-subscriptions/:id` | (Vice) Gerente | Eliminazione sottoscrizione |

* **GET `/api/user-subscriptions`**: Restituisce le sottoscrizioni della sede (filtrabili per `user_id`) calcolando `remaining_entrances` tramite il conteggio delle righe valide in `user_schedules`.
* **POST `/api/user-subscriptions`**: Riceve `user_id`, `subscription_id` e `start_date`; calcola `end_date` e copia `entrances` dal template creando il record in `users_subscriptions`.
* **PUT `/api/user-subscriptions/:id`**: Modifica `end_date` e/o `entrances`, bloccando il salvataggio se la nuova `end_date` precede lezioni già prenotate/in coda o se `entrances` è inferiore alle entrate già usate.
* **DELETE `/api/user-subscriptions/:id`**: Imposta `deleted_at` sulla sottoscrizione dopo aver verificato che non abbia lezioni attive/in coda future collegate.

### 6. Utenti e Clienti (Users)

| Metodo | Endpoint | Permessi | Scopo |
| :--- | :--- | :--- | :--- |
| GET | `/api/users` | Lavoratori | Lista utenti della sede |
| GET | `/api/users/:id` | Lavoratori | Dettaglio utente e sottoscrizioni |
| POST | `/api/users` | (Vice) Gerente | Creazione/abilitazione utente |
| PUT | `/api/users/:id` | (Vice) Gerente | Modifica anagrafica utente |
| PUT | `/api/users/:id/roles` | (Vice) Gerente | Modifica ruoli utente |
| POST | `/api/users/:id/reset-password` | (Vice) Gerente | Reset password con invio email |
| POST | `/api/users/email` | (Vice) Gerente | Invio email a uno o più clienti |
| DELETE | `/api/users/:id` | (Vice) Gerente | Eliminazione utente dalla sede |

* **POST `/api/users`**: Verifica l'assenza dell'email nella sede; se l'email non esiste in `users` crea l'account con password casuale, lo associa in `users_centers` e invia email di benvenuto, altrimenti associa l'account esistente e invia email informativa.
* **PUT `/api/users/:id`**: Aggiorna `name`, `surname` e `phone_number` nella tabella `users_centers` per la sede corrente.
* **PUT `/api/users/:id/roles`**: Aggiorna `is_instructor` e (solo se chi opera è il gerente) `is_assistant_manager`; blocca la rimozione di `is_instructor` se l'utente ha lezioni non terminate assegnate.
* **POST `/api/users/:id/reset-password`**: Genera una nuova password casuale sicura, aggiorna `password_hash` in `users` e la invia via email all'utente.
* **POST `/api/users/email`**: Permette al (vice) gerente di inviare una comunicazione email a uno o più clienti della sede.
* **DELETE `/api/users/:id`**: Blocca l'operazione se l'utente è il gerente, se ha lezioni attive/future come cliente o istruttore o se ha sottoscrizioni attive; altrimenti imposta `deleted_at` in `users_centers`.

### 7. Riepilogo Cliente (Customer Summary)

| Metodo | Endpoint | Permessi | Scopo |
| :--- | :--- | :--- | :--- |
| GET | `/api/customer/summary` | Cliente | Dati pagina riepilogo cliente |

* **GET `/api/customer/summary`**: Restituisce in un'unica chiamata per il cliente loggato nella sede attiva: lezioni con iscrizione attiva (`ENROLLING`, `UPCOMING`, `ACTIVE`), lezioni annullate fino a fine orario, sottoscrizioni attive e sottoscrizioni scadute.

---

## Logica recupero password tramite token stateless

1. L’utente inserisce l’email nella pagina di recupero password
2. Il backend genera una stringa crittografata (usando una password segreta del server salvata su Cloudflare) che contiene al suo interno: `id` dell'utente, orario di scadenza (`ora attuale + 30 minuti`) e gli ultimi 8 caratteri dell'attuale `password_hash` dell'utente
3. Il backend invia via email il link `https://dominio.com/recover?token=xyz`
4. L'utente apre il link e sceglie la nuova password
5. Il backend controlla che la firma crittografata sia autentica, che non siano passati 30 minuti e che gli 8 caratteri di `password_hash` corrispondano ancora a quelli nel DB
6. Il backend salva il nuovo `password_hash` nella tabella `users`