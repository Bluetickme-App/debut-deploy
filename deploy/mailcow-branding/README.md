# mailcow / SOGo webmail — DebutDeploy branding

Recolours the mail server's webmail from mailcow's default green to DebutDeploy blue
(`#2563eb`) and swaps in the DebutDeploy hexagon logo. Applied live on `debut-mail-2`
(46.224.111.182) 2026-07-08. Kept here so a mail-box rebuild can re-apply it.

## What each file does

| File | Where it goes on the box | Effect |
|---|---|---|
| `custom-sogo.js` | `data/conf/sogo/custom-sogo.js` | Injects blue CSS into the **SOGo inbox** (toolbar, compose FAB, links). The Angular `custom-theme.js` mechanism is NOT loaded by mailcow, so we override the generated theme classes with CSS instead. Also guards the pre-existing CKEDITOR-on-inbox error and keeps the login→`/user` redirect + `mc_logout`. |
| `custom-fulllogo.svg` / `custom-shortlogo.svg` / `custom-fulllogo-dark.svg` | `data/conf/sogo/` | DebutDeploy hexagon logos for SOGo. |
| `0081-custom-mailcow.css` | `data/web/css/build/0081-custom-mailcow.css` | Blue accent for the **mailcow `/user` login** (the page users actually hit — the SOGo login redirects there). Overrides mailcow's green buttons/links. |

The **mailcow login logo + names** are NOT files — they're Redis keys set via the Customize
mechanism (`MAIN_LOGO`, `MAIN_LOGO_DARK`, `MAIN_NAME`, `TITLE_NAME`, `APPS_NAME`). See `apply.sh`.

## Re-apply (from repo root, needs the mailcow SSH key)

```bash
KEY=/path/to/mailcow_key ./deploy/mailcow-branding/apply.sh 46.224.111.182
```
