### Script and File Descriptions

Here is a summary of each script, what it does, and how to run it.

*   **`srvr/backup-mlap-mount`**
    *   **Purpose:** Mounts a `restic` backup repository as a FUSE filesystem. This allows you to browse the backup snapshots as if they were regular directories.
    *   **How to run:** `./srvr/backup-mlap-mount`
    *   **Details:** The script mounts the repository located at `/mnt/media/backup/mlap` onto the `/mnt/mlap-bkup` directory. It requires `restic` to be installed and a password file at `/root/dev/apps/mlap-bkup/.restic`. If the mount point is already active, it will be unmounted first.

*   **`srvr/mlap-add-folders`**
    *   **Purpose:** Selects a specific backup snapshot, bind-mounts key folders from it (`/root` and a Windows user profile), and adds them to your VS Code workspace. This is useful for inspecting the state of files from a past backup.
    *   **How to run:** `./srvr/mlap-add-folders [snapshot_specifier]`
    *   **Details:** The `snapshot_specifier` can be an index (e.g., `0` for the latest, `1` for the one before), a date/time string (e.g., `"2026/06/01 15:00"`), or omitted to use the latest snapshot. The script automatically starts the main FUSE mount if it's not running. It updates the `srvr/mlap-bkup-time` file with the timestamp of the selected snapshot.

*   **`srvr/list-bkups`**
    *   **Purpose:** Lists the available snapshots in the restic repository.
    *   **How to run:** `./srvr/list-bkups`
    *   **Details:** This script connects to the restic repository and prints a list of all snapshot dates and times.

*   **`srvr/mlap-fuse`**
    *   **Purpose:** A convenience script that acts as a shortcut for `~/mlap-add-folders`.
    *   **How to run:** `./srvr/mlap-fuse [snapshot_specifier]`
    *   **Details:** It simply passes all its arguments directly to the `~/mlap-add-folders` script.

