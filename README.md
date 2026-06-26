# BOMAX KOC Worker

Electron desktop tool for scraping TikTok KOC lead data and sending it to BOMAX Hub.

## Development

```powershell
npm install
npm start
```

## Build Windows Installer

```powershell
npm run build
```

Build artifacts are created in `dist/`.

## Auto Update Release Flow

Auto update uses GitHub Releases from:

```text
ngotruongdung/scratch-koc-tiktokshop
```

For each release:

1. Bump `version` in `package.json`.
2. Run `npm run build`.
3. Create a GitHub Release with tag `v<version>`, for example `v1.0.1`.
4. Upload these files from `dist/`:
   - `BOMAX-KOC-Worker-<version>.exe`
   - `BOMAX-KOC-Worker-<version>.exe.blockmap`
   - `latest.yml`

Installed apps will check GitHub Releases for updates and prompt users to restart after the update is downloaded.
