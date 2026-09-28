# Follower Pruner

[![Regenerative software: inspired](https://img.shields.io/badge/Regenerative_software-inspired-2ea44f)](https://chadfowler.com/regenerative-software/)

A minimal Chrome extension for removing followers from your own X account using
name, handle, bio, and follower-count rules. Plain JavaScript, no runtime
dependencies, and a small Start/Stop popup. Test mode is on by default.

[PROMPT.md](PROMPT.md) is a useful initial prompt for recreating this project,
following [Chad Fowler's regenerative software principles](https://chadfowler.com/regenerative-software/).

## Install

Requires Chrome or Chromium and Node.js 22 or newer.

```sh
git clone https://github.com/carsonfarmer/follower-pruner.git
cd follower-pruner
npm test
npm run build
```

No `npm install` is needed. Open `chrome://extensions`, enable **Developer mode**,
select **Load unpacked**, and choose this repository's `dist/` directory.

After updating the source, run `npm run build`, click **Reload** on the extension,
and refresh the X tab. Rebuilding alone does not replace the running script.
Reloading the same installed extension preserves its saved progress when the
rules have not changed. Loading a different unpacked directory can create a
separate extension with separate storage; keep using the same directory to
retain your existing progress.

## Use

1. Set X's display language to English and open your own Followers list:
   `https://x.com/YOUR_HANDLE/followers`.
2. Open Follower Pruner and click **Start test** to preview the matches.
3. To remove matches, turn off **Test mode** and click **Start removing**.
4. Keep the X tab open and in the foreground. Closing the popup leaves the run
   active; reopen it to view totals or click **Stop**.
5. Leave **Resume saved progress** checked to continue. Uncheck it before starting
   to reset the selected account/mode and recheck everyone.

Use one tab at a time. Stop interrupts waits and prevents subsequent clicks, but
cannot undo a removal already submitted. Refreshing X stops the run; restarting
is always manual. If stopped on a profile, return to your Followers list and
close any leftover menu or confirmation before starting again.

## Matching rules

Any one rule is sufficient. Keyword lists below show examples; see
[core.js](core.js) for the full lists.

| Field | Match |
| --- | --- |
| Display name | Contains `♦️` or `♦`, including emoji rendered as images |
| Display name, handle, or bio | Contains `crypto`, `web3`, `meme`, `degen`, `defi`, `dao`, `dex`, `$`, `bitcoin`, `solana`, `ethereum`, or `nft` |
| Bio only | Contains `follow`, `btc`, or `airdrop` |
| Bio | Confirmed empty or whitespace-only |
| Followers | Fewer than 20; exactly 20 is kept unless another rule matches |

Keywords are case-insensitive **substrings**: `NFTs`, `MyEthereumApp`, and
`Following my dreams` match. `eth` is not a keyword. Edit [core.js](core.js) to
change the rules.

The extension checks rows and hover cards first, opening profiles for live
removal or missing data. Unreadable data is never assumed to mean no bio or zero
followers. Live mode uses **Remove this follower**; it does not block or unfollow.
Test mode never opens removal controls.

## Progress and results

The popup shows status and **Processed / Removed** totals (**Would remove** in
test mode). For account details, open the X tab's developer console and filter
for `Follower Pruner`.

- **WOULD REMOVE (TEST)** and **REMOVED** entries show the extracted fields and
  matching reasons with a bold red label.
- **Kept** means no rules matched. **Skipped** means the profile was unreadable.
- **UNCONFIRMED** means removal was attempted but could not be verified. The tool
  returns to the list and continues, leaving that account for a later run.

Completed accounts and totals are saved after each result. Test/live checkpoints
are separate for each signed-in account. Stops, refreshes, and browser restarts
preserve them. Updates with unchanged rules preserve them too; changing filtering
rules intentionally starts a fresh pass so previously kept accounts are rechecked.

Processed includes completed kept, skipped, test-match, and verified-removal
results. Unconfirmed removals are not counted or saved as completed, and are
attempted only once per run. A later resume retries them. Completed unreadable
profiles are retried by starting fresh. After a refresh, X may need to scroll
through earlier rows, but saved accounts skip their hover/profile checks.

## Timing and recovery

Timing settings are saved locally. Live mode is never saved as the default.

| Setting | Default |
| --- | ---: |
| Scroll delay | 250 ms |
| Action delay | 2000 ms |
| Hover delay | 350 ms |
| Profile load delay | 1000 ms |
| Max follower find attempts | 3 |
| Max hover card attempts | 5 |
| Max scroll attempts without progress | 5 |

Removal is submitted once. Verification captures fresh success/error notices and,
when needed, reopens the account menu with increasing waits—2, 4, and 6 seconds
at the default action delay. A verified removal is saved before menu cleanup,
so a cleanup failure does not lose its count.

If X still offers removal for the same account after those checks, the extension
returns to the list and defers that account. Explicit X errors, unexpected
identity/navigation, a stuck confirmation, or failure to return safely stop the
run with progress saved.

X's markup and loading behavior can change. The final “no new accounts” message
means the scroll attempts found no further progress; slow loading may need another
run or longer delays. Recognized visible rate-limit notices stop the run, but
there is no daily quota tracking or universal detection of silent X failures.

## Development

```sh
npm test       # Node regression tests; no install needed
npm run build  # Copy extension assets into dist/; verify matching versions
```

Browser fixtures use Playwright and intercept every request; they do not access
or modify real X accounts. To run them locally:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

Alternatively, use an existing Playwright installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
```

CI runs the Node tests and build. Browser fixtures cover filtering, identity
checks, removal verification/recovery, Stop, scrolling, persistence, and the
popup. Check current X behavior in test mode when changing DOM interactions.

The main files are [core.js](core.js) (rules and parsing),
[content.js](content.js) (scanning and removal), and [popup.js](popup.js)
(controls). Build output is ignored by Git; bump both `package.json` and
`manifest.json` when shipping an extension update.

## License

[MIT](LICENSE). Inspired by [X Bot Remover](https://github.com/vanrohan/xbotremover);
original license notices are retained.
