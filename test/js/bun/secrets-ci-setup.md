# Secrets API CI Setup Guide

This guide explains how to run the `Bun.secrets` API tests in CI environments on Linux (Ubuntu/Debian).

## Overview

The `Bun.secrets` API uses the system keyring to store credentials securely. On Linux, this requires:
- libsecret library for Secret Service API integration
- gnome-keyring daemon for credential storage  
- D-Bus session for communication
- Proper keyring initialization

## Quick Setup for CI

### Option 1: Use the provided script (Recommended)

```bash
# Install required packages first (in CI setup)
apt-get update && apt-get install -y libsecret-1-dev gnome-keyring dbus-x11

# Run the secrets tests
./scripts/test-secrets-linux.sh
```

### Option 2: Manual setup

```bash
# 1. Install packages
apt-get update && apt-get install -y libsecret-1-dev gnome-keyring dbus-x11

# 2. Run tests in D-Bus session with keyring setup
dbus-run-session -- sh -c '
  export DISPLAY=:99
  mkdir -p ~/.local/share/keyrings
  cat > ~/.local/share/keyrings/login.keyring << EOF
[keyring]
display-name=login
ctime=1609459200
mtime=1609459200
lock-on-idle=false
lock-after=false
EOF
  echo -n "" | gnome-keyring-daemon --daemonize --login
  bun test test/js/bun/secrets.test.ts
'
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
- name: Install keyring packages
  run: |
    sudo apt-get update
    sudo apt-get install -y libsecret-1-dev gnome-keyring dbus-x11

- name: Run secrets tests  
  run: ./scripts/test-secrets-linux.sh
```

### BuildKite
```yaml
steps:
  - command: |
      apt-get update && apt-get install -y libsecret-1-dev gnome-keyring dbus-x11
      ./scripts/test-secrets-linux.sh
    label: "🔐 Secrets API Tests"
```

### Docker
```dockerfile
RUN apt-get update && apt-get install -y \
    libsecret-1-dev \
    gnome-keyring \
    dbus-x11

# In your test script:
# ./scripts/test-secrets-linux.sh
```