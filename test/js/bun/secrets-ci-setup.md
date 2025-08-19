# Secrets API CI Setup Guide

This guide explains how to run the `Bun.secrets` API tests in CI environments on Linux (Ubuntu/Debian).

## Overview

The `Bun.secrets` API uses the system keyring to store credentials securely. On Linux, this requires:
- libsecret library for Secret Service API integration
- gnome-keyring daemon for credential storage  
- D-Bus session for communication
- Proper keyring initialization

## Automatic CI Setup (Recommended)

The secrets test automatically detects CI environments and sets up everything needed:

```bash
# Just run the test normally - setup happens automatically!
bun test test/js/bun/secrets.test.ts
```

The test will:
1. **Detect CI environment** - Checks if running on Linux + Ubuntu/Debian in CI
2. **Install packages** - Automatically installs required packages if missing
3. **Setup keyring** - Creates keyring directory and configuration
4. **Initialize services** - Starts D-Bus and gnome-keyring-daemon
5. **Run tests** - Executes all secrets API tests

## Manual CI Setup

If automatic setup doesn't work, you can pre-install packages:

```bash
# Install packages in CI setup step
apt-get update && apt-get install -y libsecret-1-dev gnome-keyring dbus-x11

# Run tests normally
bun test test/js/bun/secrets.test.ts
```

## Required Packages

On Ubuntu/Debian systems, install these packages:

```bash
apt-get install -y \
  libsecret-1-dev \   # libsecret development headers
  gnome-keyring \     # GNOME Keyring daemon
  dbus-x11           # D-Bus X11 integration
```

## Environment Variables

The test automatically detects CI environments and sets up the keyring. You can force setup with:

```bash
FORCE_KEYRING_SETUP=1 bun test test/js/bun/secrets.test.ts
```

## How It Works

1. **Detection**: Tests check if running on Linux + Ubuntu/Debian in CI
2. **Packages**: Verify libsecret is available 
3. **Directory**: Create `~/.local/share/keyrings/` directory
4. **Keyring**: Create `login.keyring` file with empty password setup
5. **Daemon**: Start `gnome-keyring-daemon` with login keyring
6. **D-Bus**: Ensure D-Bus session is available for communication
7. **Tests**: Run secrets tests which use the Secret Service API

## Platform Support

- ✅ **Linux (Ubuntu/Debian)**: Full support with automatic CI setup
- ✅ **Linux (Other)**: Manual setup required (see above commands)
- ⚠️  **macOS**: Uses macOS Keychain (different implementation)
- ⚠️  **Windows**: Uses Windows Credential Manager (different implementation)

## Troubleshooting

### "libsecret not available"
- Install `libsecret-1-dev` package
- Verify with: `pkg-config --exists libsecret-1`

### "Cannot autolaunch D-Bus without X11 $DISPLAY"  
- Run tests inside `dbus-run-session` 
- Set `DISPLAY=:99` environment variable

### "Object does not exist at path '/org/freedesktop/secrets/collection/login'"
- Create the login keyring file as shown above
- Start gnome-keyring-daemon with `--login` flag

### "Cannot create an item in a locked collection"
- Initialize keyring with empty password: `echo -n "" | gnome-keyring-daemon --unlock`
- Ensure keyring file has `lock-on-idle=false`

## CI Configuration Examples

### GitHub Actions
```yaml
- name: Run secrets tests (auto-setup)
  run: bun test test/js/bun/secrets.test.ts
```

Or with explicit package installation:
```yaml
- name: Install keyring packages  
  run: |
    sudo apt-get update
    sudo apt-get install -y libsecret-1-dev gnome-keyring dbus-x11

- name: Run secrets tests
  run: bun test test/js/bun/secrets.test.ts
```

### BuildKite
```yaml
steps:
  - command: bun test test/js/bun/secrets.test.ts
    label: "🔐 Secrets API Tests"
```

### Docker
```dockerfile
# Optional: pre-install packages for faster test startup
RUN apt-get update && apt-get install -y \
    libsecret-1-dev \
    gnome-keyring \
    dbus-x11

# Run test normally - setup is automatic
RUN bun test test/js/bun/secrets.test.ts
```