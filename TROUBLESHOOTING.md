# Troubleshooting Guide

## Commands Not Appearing

### Step 1: Check Extension Activation

1. Open **Output Panel**: `Ctrl+Shift+U` (or `Cmd+Shift+U`)
2. Select **"Log (Extension Host)"** from the dropdown
3. Look for: `RN Profiler AI extension is now active!`
4. If you see errors, note them down

### Step 2: Reload Window

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P`)
2. Type: `Developer: Reload Window`
3. Press Enter
4. Try the commands again

### Step 3: Verify Commands

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P`)
2. Type: `RN Profiler`
3. You should see 4 commands:
   - `RN Profiler AI: Show Profiler Panel`
   - `RN Profiler AI: Start Recording`
   - `RN Profiler AI: Stop Recording`
   - `RN Profiler AI: Analyze Logs`

### Step 4: Check Debug Console

If using F5 (Development Mode):
1. In the **original window** (where you pressed F5)
2. Check the **Debug Console** at the bottom
3. Look for error messages

### Step 5: Recompile

If commands still don't appear:

```bash
npm run compile
```

Then reload the window again.

## Common Issues

### "Extension activation failed"

- Check that all dependencies are installed: `npm install`
- Verify TypeScript compiled: `npm run compile`
- Check the Output panel for specific errors

### "Command not found"

- Reload the window: `Ctrl+R`
- Check that extension is activated (see Step 1)
- Verify `package.json` has the commands defined

### Extension doesn't activate

- Make sure you're in a workspace (open a folder)
- Check activation events in `package.json`
- Try opening a React Native project folder

## Still Not Working?

1. **Check the original window** (where you pressed F5)
2. Look at the **Debug Console** for errors
3. **Share the error message** for help

## Quick Test

Try this command directly:
1. `Ctrl+Shift+P`
2. Type: `RN Profiler AI: Show Profiler Panel`
3. Press Enter

If this works, the extension is active! If not, check the Output panel for errors.

