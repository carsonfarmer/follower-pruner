# Working on Follower Pruner

Keep this extension small: plain JavaScript, no runtime dependencies, a minimal
popup, and detailed console logs. Follow the user's current filtering preferences.
Rules are intentionally editable: when asked to change them, make the change,
check it, and rebuild the extension rather than stopping at instructions.

## Change the rules

Edit [core.js](core.js), which contains the rule definitions:

- `keywords`: lowercase substrings matched against display name, handle, and bio.
- `bioKeywords`: additional lowercase substrings matched only against the bio.
- `reasons({ name, handle, bio, followers })`: diamond, empty-bio, and follower-count
  checks, plus the keyword matching logic. Any returned reason flags the account.

To add a keyword, add a quoted lowercase string to the appropriate array. To
remove one, delete its entry. For example, add `'exampleword'` to `bioKeywords`
for a bio-only match, or to `keywords` to search all three fields. Matching is
case-insensitive and happens anywhere in the text, including inside longer words.

To change the follower threshold, edit the comparison and its reason text in
`reasons()`. Adjust other conditions there too. Preserve the distinction between
unknown data and confirmed empty/zero values. Update relevant expectations in
[test/rules.test.mjs](test/rules.test.mjs), including field scope and boundary cases.

Keyword edits automatically change the saved rule fingerprint. For changes to
other conditions or matching scope, update `ruleSignature` in
[content.js](content.js) to include the changed rule values. This ensures previously
processed accounts are rechecked. Explain that changed rules start a fresh pass;
ordinary restarts and updates with unchanged rules should preserve progress.

## Check, build, and hand off

For shipped rule or behavior changes, bump the version in both `package.json`
and `manifest.json` to the same value. Documentation-only edits need no version bump.
Run these from the repository root; Node.js 22+ is required and no install is needed:

```sh
npm test
npm run build
```

Edit source files, then generate `dist/` with the build; it is ignored by Git.
For changes to page interaction, recovery, or persistence, also run
`npm run test:browser` using the Playwright setup in [README.md](README.md).
Use fixtures and test mode for verification; never remove real followers as a test.

After rebuilding, report the change, version, and checks run. Tell the user to:

1. Stop any active run.
2. Open `chrome://extensions` and click **Reload** on Follower Pruner.
3. Refresh the X tab, open their own Followers list, and start in **Test mode**.

Rebuilding alone does not update an already injected script. Rebuild the directory
used by the installed extension and reload that same installation: loading a new
unpacked directory can create separate storage and lose access to saved progress.

## Starting from scratch

[PROMPT.md](PROMPT.md) is a useful initial prompt for recreating this project,
following [Chad Fowler's regenerative software principles](https://chadfowler.com/regenerative-software/).
