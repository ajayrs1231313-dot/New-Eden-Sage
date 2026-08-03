# New Eden Sage

New Eden Sage is a local-first Windows desktop companion for EVE Online. It keeps ESI credentials on your PC and combines character intelligence, skills, fittings, public market data, trade-route analysis and portable data exports in one application.

## Download and install

1. Open the repository's **Releases** page.
2. Download the newest `New-Eden-Sage-Setup-*.exe`.
3. Run the installer and choose whether to create a desktop shortcut.
4. Windows SmartScreen may show an **Unknown publisher** warning because community builds are not code-signed. Choose **More info**, confirm the filename came from this repository, then choose **Run anyway**.
5. Start **New Eden Sage**.

App data is stored under `%LOCALAPPDATA%\New Eden Sage Data`. Existing installations that already use `F:\New Eden Sage Data` continue using that folder.

## Create your EVE application

Create an EVE developer application for New Eden Sage:

1. Sign in at [EVE Online Developers](https://developers.eveonline.com/applications).
2. Create a new application.
3. Use a name such as `My New Eden Sage`.
4. Use a description such as `Private local EVE Online character, skills, fittings and market helper`.
5. Select the desktop/native **Authorization Code with PKCE** connection type when offered.
6. Set the callback URL exactly to:

   ```text
   http://localhost:42813/auth/eve/callback
   ```

7. Enable the ESI scopes you want New Eden Sage to collect. For the complete character export, enable all available character and corporation read scopes used by your characters.
8. Finish creating the application and copy its **Client ID**.

New Eden Sage uses PKCE, the recommended flow for desktop applications. It does **not** need or accept your Client Secret.

Official reference: [EVE SSO Authorization Code with PKCE](https://developers.eveonline.com/docs/services/sso/).

## Connect a character

1. Open **Settings** in New Eden Sage.
2. Paste the EVE application **Client ID** and save it.
3. Select **Connect character**.
4. Sign in through the official EVE Online page, select a character and approve the scopes.
5. Return to New Eden Sage after the browser confirms the connection.
6. Repeat **Connect character** for additional characters.

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

New Eden Sage is released under the MIT License. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

EVE Online and all related logos and designs are the intellectual property of CCP hf. This project is an independent third-party application and is not affiliated with or endorsed by CCP hf.
