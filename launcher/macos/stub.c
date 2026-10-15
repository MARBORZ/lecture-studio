/*
 * Native executable of "Lecture Studio.app".
 * A real (non-platform) binary is required so macOS attributes file access to the app
 * and can ask once for Desktop/Documents permission; /bin/zsh alone is silently denied.
 * It runs launcher/start.zsh and waits for it (a few seconds), then exits.
 */
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>

#ifndef LAUNCHER_SCRIPT
#error "build with -DLAUNCHER_SCRIPT=\"/abs/path/launcher/start.zsh\""
#endif

extern char **environ;

int main(void) {
    char *argv[] = {"/bin/zsh", LAUNCHER_SCRIPT, NULL};
    pid_t pid;
    if (posix_spawn(&pid, "/bin/zsh", NULL, NULL, argv, environ) != 0) {
        perror("posix_spawn");
        return 1;
    }
    int status = 0;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
