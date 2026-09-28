Starting in an empty folder, build a minimal Chrome extension called **Follower Pruner** that removes matching followers from my own X account. Deliver working source, a ready-to-load `dist/` folder, tests, and short installation/rebuild instructions. Use plain JavaScript and a simple dependency-free build. Choose the implementation yourself; keep the UI and code small.

An account matches if **any** of these rules applies:

- Its display name contains `♦️` or `♦`, including emoji rendered as images.
- Its display name, handle, or bio contains any of these case-insensitive substrings: `crypto`, `web3`, `meme`, `degen`, `defi`, `fuck`, `shit`, `dao`, `dex`, `$`, `onlyfans`, `bitcoin`, `solana`, `ethereum`, `nft`.
- Its bio contains any of these additional case-insensitive substrings: `sahara`, `follow`, `spaace_ai`, `btc`, `gnoma`, `airdrop`, `cnpynetwork`.
- Its bio is confirmed empty or whitespace-only.
- It has fewer than 20 followers.

Match anywhere in the text: `NFTs` and `following` match. Use `ethereum`, not `eth`. The diamond rule is for display names; the additional bio keywords stay bio-only. Preserve handle matches when replacing row data with hover/profile data. Unknown data must never become an empty bio or zero followers, although another independently established rule can still match.

Provide a small popup with Test mode (default on), Resume saved progress (default on), Start, Stop, collapsible settings, and Processed/Removed totals—or Would remove in test mode. Closing the popup must leave the run running. Keep account details in the console, with the extracted fields and reasons. Make matches and unconfirmed removals conspicuous. Disable conflicting controls during a run and prevent duplicate runs.

Use these saved, configurable defaults. All delays are milliseconds:

- Scroll delay: 250
- Action delay: 2000
- Hover delay: 350
- Profile load delay: 1000
- Max follower find attempts: 3
- Max hover card attempts: 5
- Max scroll attempts without progress: 5

Validate settings. Apply delays to their corresponding actions, use bounded retries for slow loading, and make waits promptly interruptible by Stop. For removal verification, use up to three checks with increasing waits: action delay × attempt number, or 2/4/6 seconds by default.

Run only on the signed-in user's own loaded Followers list. English X UI is sufficient. Use visible website controls, not private APIs. Stop if the user changes page/account. Test mode must never open removal controls or confirm removal; enforce this inside the removal path too.

Check the follower row first, then its hover card. Open a full profile only for live removal or to resolve missing information. Recheck the intended profile before a live action. Preserve list position and scroll only when necessary. Returning to the list should wait for it to load before restoring scroll. Re-query virtualized rows and track normalized handles so disappearing/recycled rows don't skip accounts. Passing previously processed rows is still scrolling progress, not evidence that the list has ended.

Account for these specific problems found during real use:

- **Text extraction:** Emoji may be IMG alt text. A follower row may itself be a button, so excluding all button descendants loses its bio. Hidden “Click to Follow” labels, Follow buttons, and “Follows you” are not bio text—especially important with the `follow` rule.
- **Identity and hover cards:** Hover the textual name link; the first link may be a hidden avatar that doesn't trigger a card. Reject stale cards belonging to another account. Profile text can concatenate as `Name@handleFollows you`; verify the dedicated handle element rather than a word boundary on that combined string. Read follower links ending in either `/followers` or `/verified_followers`, not the following count. Support commas and K/M/B counts.
- **Incomplete data:** A missing hover-card bio is unknown, even if the row showed text. Confirm an empty bio on a loaded, identified profile. Skip and log unreadable profiles rather than marking them kept or assuming a match. Ignore sidebar suggestions and recommendations.
- **Removal verification:** Verify the exact target in the profile/menu/confirmation, including distinguishing `@ann` from `@anna`. Submit “Remove this follower” once. Closing the dialog alone isn't success. Capture fresh target-specific success/error notices as they appear; they may vanish before a delay ends. Recognize “@handle is no longer following you” as well as “removed … followers.” Ignore old notices and notices about other accounts.
- **Stale menus:** Without a reliable success notice, reopen the target's menu and verify the removal action has disappeared. An empty or wrong-account menu proves nothing. An open menu and “Follows you” can retain stale state even after a success toast. Escape may require both keydown and keyup; keydown alone left menus stuck.
- **Counting:** Once removal is verified, count and persist it before menu cleanup or other fallible waits. A later cleanup failure or Stop must not lose the result or cause another removal attempt.
- **Recovery:** If bounded verification still offers removal for the correct account, with no explicit X error or pending confirmation, log UNCONFIRMED, return to the list, restore position, and continue. Defer that account only for this run to avoid an endless loop. Leave it unfinished and uncounted so a later resume can retry it. Never blindly retry every error: mismatched identity, stuck confirmation, failed navigation, explicit rejection/rate-limit notices, and Stop halt the run with progress saved. Recovery must also obey Stop.

Persist completed handles and totals after every completed account, separately for each signed-in account and test/live mode. Ordinary stops, refreshes, browser restarts, and updates with unchanged rules preserve progress. Resume skips completed checks; it may still need to scroll past earlier rows. Unchecking Resume starts fresh for that account/mode. Include a stable fingerprint of the rules and their field scopes: changed filtering rules intentionally trigger a fresh pass, then subsequent runs resume normally. Interrupted/unconfirmed accounts remain unfinished; document how skipped/unreadable accounts are treated. Storage failures must be reported and stop further removal. Never auto-start live removal after a reload.

Don't assume a 400-per-day removal cap or claim universal rate-limit detection. Recognized visible errors should stop the run; silent refusal may instead follow the unconfirmed-recovery path. Keep the limit of that behavior clear.

Test the rules and the failure cases above using realistic browser fixtures with network requests intercepted. Include test/live separation, resume after refresh, changed-rule rechecking, unchanged-rule persistence, Stop during recovery, transient notices, stale menus, and verified counts surviving cleanup failure. Read-only live inspection can validate markup; don't remove real followers as a test.

Finish by running the tests and build, checking that source and `dist/` agree, and reporting the version and results. Keep manifest/package versions consistent and bump them for shipped changes. Explain that updates require rebuilding, reloading the extension, and refreshing X; rebuilding alone does not replace an injected script. Document single-tab use and how to resume from the Followers list after a stop.
