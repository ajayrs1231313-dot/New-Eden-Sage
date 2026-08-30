# New Eden Sage

New Eden Sage is a local-first Windows desktop companion for EVE Online. It keeps ESI credentials on your PC and combines character intelligence, skills, fittings, public market data, trade-route analysis and portable data exports in one application.

## Download and install

1. Open the repository's **Releases** page.
2. Download the newest `New-Eden-Sage-Setup-*.exe`.
3. Run the installer and choose whether to create a desktop shortcut.
4. Windows SmartScreen may show an **Unknown publisher** warning because community builds are not code-signed. Choose **More info**, confirm the filename came from this repository, then choose **Run anyway**.
5. Start **New Eden Sage**.

App data is stored under `%LOCALAPPDATA%\New Eden Sage Data`. Existing installations that already use `F:\New Eden Sage Data` continue using that folder.

## Connect a character

1. Select **Add character**.
2. Sign in through the official EVE Online page, select a character and approve the requested ESI permissions.
3. Return to New Eden Sage after the browser confirms the connection.
4. Repeat **Add character** for additional characters.

New Eden Sage uses Authorization Code with PKCE and never asks for your EVE password or client secret.

Refresh tokens are encrypted with Windows secure storage. They are not included in backups, exports, Git commits or market datasets.

## Main capabilities

- Multiple connected EVE characters with selectable sync and removal
- Complete character snapshots and character-specific data exports
- Wallet, skills, queue, assets, ship, location, contracts, industry, PI, standings, killmails and other permitted ESI data
- Searchable skill list with subsequent-level training estimates
- Skill Path Planner with all published ship hulls and activity readiness scoring
- Top-five Capability Radar for popular EVE activities
- EFT-style fitting import, official EVE images and skill requirement checks
- Cheapest-fit purchase routing with owned-asset checks
- Full high-sec station orders, public contracts and 20-jump collection
- Searchable and sortable regional market browser
- Local high-sec arbitrage analysis, hauling limits and CSV export
- Timestamped character, market, contract and complete-backup exports
- Local diagnostic logging with token/secret redaction

## Updating

Download and run the newer installer from **Releases**. Your settings and local data remain in the user data folders and are not replaced by the installer.

## Development

Requirements: Node.js 22 or newer.

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run dev
```

Build the Windows installer:

```powershell
npm.cmd run dist:win
```

The installer is written to `release/`.

To publish an update, change the version in `package.json`, commit and push it, then push a tag such as `v0.2.0`. The included GitHub Actions workflow builds a new Windows installer and publishes a GitHub Release automatically.

## Security and privacy

- No hosted New Eden Sage backend
- EVE SSO uses Authorization Code with PKCE
- OAuth state and verifier values are generated for every login
- The callback listener binds only to localhost and closes after login
- Refresh tokens are encrypted with Windows secure storage
- The renderer has no direct Node.js or filesystem access
- Public market information comes from ESI and CCP's static data
- Exports intentionally exclude EVE tokens and application credentials

## License and EVE notice

New Eden Sage is source-available under the [New Eden Sage Source-Available Licence](LICENSE). You may inspect the publicly available source code for review, evaluation, understanding, or auditing, but you may not modify, fork, redistribute, republish, incorporate, adapt, commercially or non-commercially exploit, or create derivative works from it except where the Licence expressly permits. Third-party components remain subject to their own licence terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

EVE Online and all related logos and designs are the intellectual property of CCP hf. This project is an independent third-party application and is not affiliated with or endorsed by CCP hf.
