# Changelog

All notable changes to the Boost Timer application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.9] - 2025-09-18

### Added
- **Multi-screen window positioning support**: Added intelligent screen detection and window positioning
  - `getMainWindowScreen()` function to detect the main window's current screen
  - `positionWindowOnSameScreen()` function to center windows on target screens
  - Automatic positioning of focus window on the same screen as main window
- **Enhanced tray menu functionality**: Updated tray menu to handle both main and focus windows
  - Dynamic tray menu labels that reflect current window states
  - "Show", "Hide", or "Hide All" options based on window visibility
  - Real-time menu updates when window states change

### Changed
- **Focus window creation**: Modified focus window creation to position on same screen as main window
  - Added `show: false` property to prevent immediate display before positioning
  - Implemented screen-aware positioning logic
  - Enhanced `toggleFocusWindow()` function with repositioning capabilities
- **Window visibility management**: Updated `toggleWindowVisibility()` function
  - Now handles both main and focus windows intelligently
  - Hides all visible windows when any are shown
  - Shows main window when no windows are visible
- **Tray menu behavior**: Enhanced tray menu to provide better dual-window control
  - Added helper functions `isAnyWindowVisible()` and `getWindowVisibilityLabel()`
  - Implemented automatic menu refresh on window state changes
  - Added event listeners for focus window show/hide/close events

### Fixed
- **Multi-monitor support**: Resolved issues with windows opening on different screens
  - Focus window now consistently opens on the same screen as main window
  - Proper handling of multi-monitor setups with different screen configurations
- **Focus window properties**: Corrected focus window `resizable` property from `true` to `false`
- **Tray menu synchronization**: Fixed tray menu not updating when focus window state changes
  - Added event listeners for all focus window state changes
  - Ensured menu labels accurately reflect current window visibility

### Technical Improvements
- **Code organization**: Added comprehensive function-level comments
- **Event handling**: Improved event listener management for window state changes
- **Screen detection**: Implemented robust screen detection using Electron's `screen` module
- **Window positioning**: Added precise window centering calculations using screen work areas

## Previous Versions

### [1.0.8] - Previous Release
- Base countdown timer functionality
- Main window and focus window implementation
- Basic tray menu support
- Timer state management
- Todo list integration