# E-reader setup: Kindle (KOReader) and Xteink (CrossPoint)

How to set up one person's e-readers so books come from **BookOrbit**, reading
position syncs between devices, and finished books, ratings and progress end up
on that person's **Hardcover** shelf, which is what Seek reads.

Everything here is **per person**: each person uses their own BookOrbit
credentials and their own Hardcover token. Do the whole guide once for each person.

```
Kindle (KOReader + BookOrbit plugin) ─┐
                                      ├─▶ BookOrbit ──(its Hardcover sync)──▶ Hardcover ──▶ Seek
Xteink (CrossPoint: OPDS + KOSync) ───┘
```

Addresses used below:

| What | Address |
|---|---|
| BookOrbit | `https://bookorbit.nerdspar.com` |
| OPDS catalog | `https://bookorbit.nerdspar.com/api/v1/opds` |
| KOReader sync server | `https://bookorbit.nerdspar.com/api/v1/koreader` |

---

## 1. BookOrbit (in a browser, signed in as that person)

1. **KOReader credentials.** In Settings → KOReader, create a KOReader username
   and password. The Kindle plugin and the Xteink's sync both log in with these,
   so both devices must use the same ones.
2. **OPDS account.** In Settings → OPDS → OPDS Accounts, add an account (for
   example `<name>-xteink`). The Xteink uses it to browse and download. It sees
   everything that BookOrbit user can see.
3. **Hardcover sync.** In Settings → Hardcover:
   - Paste **that person's own** Hardcover API token (from hardcover.app/account/api).
   - Scope: **All eligible books**.
   - Turn on **Enable sync**, **Sync on status change**, **Sync on progress update**
     and **Sync on rating change**.
   - Privacy: whatever they prefer (Private is fine).
   - Press **Save**.
   - **Never press "Sync now".** It pushes every book's BookOrbit status to
     Hardcover and can overwrite what's set there.
4. **Seek.** In Seek → Settings → Your accounts, link the same Hardcover token,
   plus their BookOrbit login.
5. Optional: **file naming.** Settings → Reader → File Naming decides the folders
   books land in on the device. The default puts books without a series in a
   `Standalone` folder. A tidier pattern is
   `<{series}/><{seriesIndex}. ><{title}|{originalFilename}>`, which gives series
   their own folder and leaves standalone books loose in the top folder.

> **Use BookOrbit's copy of a book on every device.** Sync identifies a book by
> a fingerprint of the file itself ("binary" matching). A copy from anywhere else,
> such as Calibre or a sideload, has a different fingerprint, so its position
> never syncs with the BookOrbit copy. It doesn't show an error, it just doesn't match.
> If BookOrbit's library setting to write metadata into files is on, turn it off:
> rewriting a file changes its fingerprint.

---

## 2. Xteink (CrossPoint)

### OPDS (from a computer: no button typing)

1. On the Xteink: **File Transfer** → **Join a Network** (or Create Hotspot).
2. In a browser on the same network: `http://crosspoint.local/settings` (or
   `http://<xteink-ip>/settings`).
3. Under **OPDS Servers** → add:
   - Name: `BookOrbit`
   - URL: `https://bookorbit.nerdspar.com/api/v1/opds`
   - Username and password: the **OPDS account** from step 1.2.

### KOReader Sync (on the device: these aren't on the web page)

Settings → System → **KOReader Sync**:

| Setting | Value |
|---|---|
| KOReader Username / Password | the **KOReader credentials** from step 1.1 |
| Sync Server URL | `https://bookorbit.nerdspar.com/api/v1/koreader` |
| Document Matching | **Binary** (the default, file name, is unreliable) |
| Send Document Metadata | OFF |
| Sync Behavior | Smart sync |

Download books through the OPDS catalog so the Xteink has BookOrbit's copy (see
the note above).

---

## 3. Kindle (KOReader + BookOrbit plugin)

### 3.1 Get the plugin onto the Kindle

You need the `bookorbit.koplugin` folder on your Mac. It's the same plugin
already on Scott's Kindle, and it updates itself once installed.

**Option A: USB (easiest).** Plug the Kindle in. It shows up as a drive. Copy
`bookorbit.koplugin` into `koreader/plugins/`, then eject.

**Option B: over Wi-Fi (SSH).**

1. On the Kindle, in KOReader: Tools → Network → **SSH server** → start it. While
   copying, turn on **Login without password** (turn it off again afterwards).
   Note the IP and port it shows (for example `10.0.1.93:2222`). Network info
   shows the IP too.
2. On the Mac, copy the folder with `tar`. KOReader's SSH server has no `scp`
   program, so plain `scp` drops the connection right after login:

   ```bash
   tar -C ~/Downloads -cf - bookorbit.koplugin | ssh -p 2222 root@<kindle-ip> 'tar -C /mnt/us/koreader/plugins -xf -'
   ```

   The password prompt takes an empty Return when "Login without password" is on.
   "Rootfs is mounted read-only" after login is normal: `/mnt/us` (where KOReader
   lives) is writable.
3. Stop the SSH server, or turn off "Login without password".

Restart KOReader: top menu → Exit → **Restart KOReader**.

### 3.2 Sign in

Tools (☰) → **BookOrbit** → Account & setup:

1. **BookOrbit server address**: `https://bookorbit.nerdspar.com`
2. **Login**: the **KOReader credentials** from step 1.1.
3. Test the connection.

Open the BookOrbit dashboard to browse and download. For the download location,
choose `/mnt/us/books`.

### 3.3 Sync settings

**Open a book first.** The main switch only appears while a book is open.

Tools → **BookOrbit** → **Sync**:

| Setting | Value |
|---|---|
| **Auto sync current book** | **On**. This turns automatic syncing on for every book. |
| Periodically sync every # pages | **10** |
| Skip auto-sync when offline | Off |
| Two-way highlights & bookmarks | On |
| Sync to a newer state | **Silently** (or Prompt) |
| Sync to an older state | **Never** |

**Leave KOReader's built-in "Progress sync" off.** The BookOrbit plugin does
progress sync itself, against the same server. Running both sends every update
twice and the two fight over your position.

### 3.4 Wi-Fi (this is what makes sync on sleep work)

The plugin **fetches** your position when you open a book or wake the Kindle,
and turns Wi-Fi on to do it. It only **sends** your position (every few pages,
on close, on sleep) if Wi-Fi is already on; otherwise the update waits until
the next time the Kindle is online. So Wi-Fi has to stay on while you read.

Settings (gear) → Network:

| Setting | Value |
|---|---|
| Wi-Fi connection | On |
| Disable Wi-Fi connection when inactive | **Off** (it would cut Wi-Fi mid-chapter) |
| Restore Wi-Fi connection on resume | **On** |
| Action when Wi-Fi is off | **turn on** |
| Action when done with Wi-Fi | **leave on** (with "turn off", every send after the first gets queued) |

Wi-Fi still goes off when the Kindle sleeps and comes back when it wakes, so
the battery cost is modest. If you'd rather keep Wi-Fi off, close the book or tap
Tools → BookOrbit → Sync → **Sync current book now** before switching devices.

---

## 4. Check it works

1. Download the same book from BookOrbit on both devices: plugin on the Kindle,
   OPDS on the Xteink.
2. Read a few pages on the Kindle, then close the book (or put it to sleep with
   Wi-Fi on).
3. Open the book on the Xteink and sync. It should jump to the Kindle's spot,
   give or take a page, since the Xteink paginates for its own screen.
4. Read on, sync, and open the book on the Kindle. It should move forward too.
5. Finish or rate a book, and a minute later it shows on their Hardcover shelf
   and in Seek's Watchlist → Books.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Xteink fetches fine but lands at the start or an old spot | Different file copies (Calibre or sideloaded). Delete it and re-download from BookOrbit on both. |
| Lands a page or two off | Normal: different screens paginate differently. |
| Kindle doesn't sync on sleep | "Action when done with Wi-Fi" is set to turn off, or Wi-Fi is off. See 3.4. |
| Kindle plugin login fails | Wrong credentials: it uses the **KOReader** credentials from BookOrbit (1.1), not the BookOrbit website login. |
| `scp` says "lost connection" right after the password | KOReader's SSH server can't receive `scp`. Use the `tar` command in 3.1. |
| Xteink OPDS asks for a login again, or shows nothing | Wrong **OPDS account** (1.2). Those credentials are separate from the KOReader ones. |
| Progress doesn't reach Hardcover or Seek | BookOrbit → Settings → Hardcover: that person's token, sync switches on, saved (1.3). |
