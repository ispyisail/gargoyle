/*
 * apkexec.c -- the apk subprocess module for the gapk re-backend (see
 * docs/gapk-implementation-plan.md Phase 2 in the gargoyle-tools repo).
 * Every apk invocation gpkg's future GPKG_BACKEND=apk code paths need
 * goes through exactly one of the functions declared in apkexec.h; no
 * other file should ever exec "apk" directly.
 *
 * apk_run() mirrors xsystem.c's fork+exec style (argv vector, no shell)
 * but additionally captures stdout/stderr, since every higher-level
 * function here needs to inspect apk's output, not just its exit code.
 */

#include <erics_tools.h>
#include <unistd.h>
#include <sys/wait.h>
#include <poll.h>
#include <errno.h>

#include "json.h"
#include "apkexec.h"


const char* apk_bin_path(void)
{
	const char* p = getenv("GPKG_APK_BIN");
	return (p != NULL && p[0] != '\0') ? p : "/usr/bin/apk";
}


/* Simple growable buffer for accumulating one pipe's output. */
typedef struct
{
	char* buf;
	size_t len;
	size_t cap;
} grow_buf;

static void grow_buf_append(grow_buf* g, const char* data, size_t n)
{
	if(g->len + n + 1 > g->cap)
	{
		size_t newcap = (g->cap == 0) ? 4096 : g->cap;
		while(newcap < g->len + n + 1)
		{
			newcap *= 2;
		}
		g->buf = (char*)realloc(g->buf, newcap);
		g->cap = newcap;
	}
	memcpy(g->buf + g->len, data, n);
	g->len += n;
	g->buf[g->len] = '\0';
}


apk_result* apk_run(const char* argv[])
{
	int out_pipe[2];
	int err_pipe[2];
	pid_t pid;
	int status;
	grow_buf outb;
	grow_buf errb;
	apk_result* result;

	memset(&outb, 0, sizeof(outb));
	memset(&errb, 0, sizeof(errb));

	if(pipe(out_pipe) == -1)
	{
		fprintf(stderr, "apk_run: pipe: %s\n", strerror(errno));
		return NULL;
	}
	if(pipe(err_pipe) == -1)
	{
		fprintf(stderr, "apk_run: pipe: %s\n", strerror(errno));
		close(out_pipe[0]);
		close(out_pipe[1]);
		return NULL;
	}

	pid = fork();
	if(pid == -1)
	{
		fprintf(stderr, "apk_run: fork: %s\n", strerror(errno));
		close(out_pipe[0]); close(out_pipe[1]);
		close(err_pipe[0]); close(err_pipe[1]);
		return NULL;
	}

	if(pid == 0)
	{
		/* child */
		close(out_pipe[0]);
		close(err_pipe[0]);
		dup2(out_pipe[1], STDOUT_FILENO);
		dup2(err_pipe[1], STDERR_FILENO);
		close(out_pipe[1]);
		close(err_pipe[1]);
		execvp(argv[0], (char* const*)argv);
		_exit(127);
	}

	/* parent */
	close(out_pipe[1]);
	close(err_pipe[1]);

	{
		struct pollfd fds[2];
		int open_fds = 2;

		fds[0].fd = out_pipe[0]; fds[0].events = POLLIN; fds[0].revents = 0;
		fds[1].fd = err_pipe[0]; fds[1].events = POLLIN; fds[1].revents = 0;

		while(open_fds > 0)
		{
			int n;
			int idx;

			n = poll(fds, 2, -1);
			if(n < 0)
			{
				if(errno == EINTR) { continue; }
				break;
			}

			for(idx = 0; idx < 2; idx++)
			{
				char chunk[4096];
				ssize_t got;

				if(fds[idx].fd == -1 || !(fds[idx].revents & (POLLIN | POLLHUP | POLLERR)))
				{
					continue;
				}

				got = read(fds[idx].fd, chunk, sizeof(chunk));
				if(got > 0)
				{
					grow_buf_append(idx == 0 ? &outb : &errb, chunk, (size_t)got);
				}
				else if(got == 0)
				{
					close(fds[idx].fd);
					fds[idx].fd = -1;
					open_fds--;
				}
				else if(errno != EINTR)
				{
					close(fds[idx].fd);
					fds[idx].fd = -1;
					open_fds--;
				}
			}
		}
	}

	if(waitpid(pid, &status, 0) == -1)
	{
		fprintf(stderr, "apk_run: waitpid: %s\n", strerror(errno));
		free_if_not_null(outb.buf);
		free_if_not_null(errb.buf);
		return NULL;
	}

	result = (apk_result*)safe_malloc(sizeof(apk_result));
	result->out = (outb.buf != NULL) ? outb.buf : safe_strdup("");
	result->err = (errb.buf != NULL) ? errb.buf : safe_strdup("");

	if(WIFSIGNALED(status))
	{
		fprintf(stderr, "apk_run: %s: killed by signal %d\n", argv[0], WTERMSIG(status));
		result->exit_code = -1;
	}
	else if(WIFEXITED(status))
	{
		result->exit_code = WEXITSTATUS(status);
	}
	else
	{
		/* shouldn't happen */
		result->exit_code = -1;
	}

	return result;
}


void apk_result_free(apk_result* r)
{
	if(r == NULL) { return; }
	free_if_not_null(r->out);
	free_if_not_null(r->err);
	free(r);
}


json_value* apk_query_json(const char* root, const char* repo, const char* keysdir,
	int recursive, const char* fields, const char* pkg)
{
	const char* argv[16];
	int i = 0;
	json_value* result;
	apk_result* r;

	argv[i++] = apk_bin_path();
	argv[i++] = "query";
	argv[i++] = "--root";
	argv[i++] = root;
	if(keysdir != NULL) { argv[i++] = "--keys-dir"; argv[i++] = keysdir; }
	if(repo != NULL) { argv[i++] = "--repository"; argv[i++] = repo; }
	if(recursive) { argv[i++] = "--recursive"; }
	argv[i++] = "--format";
	argv[i++] = "json";
	argv[i++] = "--fields";
	argv[i++] = fields;
	argv[i++] = pkg;
	argv[i++] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return NULL; }

	/* A no-match world is not an error -- apk exits 0 with an empty
	 * JSON array on stdout and a diagnostic on stderr in that case.
	 * Parse whatever's on stdout regardless of exit_code/stderr; only
	 * a genuinely unparseable stdout is treated as failure. */
	result = json_parse(r->out);
	if(result == NULL)
	{
		fprintf(stderr, "apk_query_json: could not parse apk output: %s\n",
			(r->err[0] != '\0') ? r->err : r->out);
	}
	apk_result_free(r);
	return result;
}


/* Finds the most-recently-modified file in dir whose name starts with
 * "<pkg>-" (dash-boundary check so "bar" cannot match "barbaz-1.0.apk").
 * Returns a newly-malloc'd full path, or NULL if no match. */
static char* glob_pkg_prefix(const char* dir, const char* pkg)
{
	DIR* d;
	struct dirent* ent;
	size_t plen = strlen(pkg);
	char* found = NULL;
	time_t found_mtime = 0;

	d = opendir(dir);
	if(d == NULL) { return NULL; }

	while((ent = readdir(d)) != NULL)
	{
		if(strncmp(ent->d_name, pkg, plen) == 0 && ent->d_name[plen] == '-')
		{
			char* path = dynamic_strcat(3, dir, "/", ent->d_name);
			struct stat st;

			if(stat(path, &st) == 0 && (found == NULL || st.st_mtime >= found_mtime))
			{
				free_if_not_null(found);
				found = path;
				found_mtime = st.st_mtime;
			}
			else
			{
				free(path);
			}
		}
	}
	closedir(d);
	return found;
}


char* apk_fetch(const char* root, const char* repo, const char* keysdir,
	const char* outdir, const char* pkg)
{
	const char* argv[16];
	int i = 0;
	apk_result* r;
	char* found;

	argv[i++] = apk_bin_path();
	argv[i++] = "fetch";
	argv[i++] = "--root";
	argv[i++] = root;
	if(keysdir != NULL) { argv[i++] = "--keys-dir"; argv[i++] = keysdir; }
	if(repo != NULL) { argv[i++] = "--repository"; argv[i++] = repo; }
	argv[i++] = "--output";
	argv[i++] = outdir;
	argv[i++] = pkg;
	argv[i++] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return NULL; }

	if(r->exit_code != 0)
	{
		fprintf(stderr, "apk_fetch: %s\n", (r->out[0] != '\0') ? r->out : r->err);
		apk_result_free(r);
		return NULL;
	}
	apk_result_free(r);

	/* Deliberately not parsing apk's progress text -- see apkexec.h's
	 * apk_fetch doc comment. exit_code 0 means the file is present in
	 * outdir either way (freshly downloaded or already cached); find it
	 * by name instead. */
	found = glob_pkg_prefix(outdir, pkg);
	if(found == NULL)
	{
		fprintf(stderr, "apk_fetch: apk exited 0 but no %s-* file found in %s\n", pkg, outdir);
	}
	return found;
}


string_map* apk_manifest(const char* root, const char* keysdir, const char* file, int allow_untrusted)
{
	const char* argv[9];
	int i = 0;
	apk_result* r;
	string_map* result;
	char* buf;
	char* line;
	char* saveptr;

	argv[i++] = apk_bin_path();
	argv[i++] = "manifest";
	argv[i++] = "--root";
	argv[i++] = root;
	if(keysdir != NULL) { argv[i++] = "--keys-dir"; argv[i++] = keysdir; }
	if(allow_untrusted) { argv[i++] = "--allow-untrusted"; }
	argv[i++] = file;
	argv[i++] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return NULL; }

	/* apk manifest exits 0 even when <file> doesn't exist, printing
	 * "ERROR: <path>: ..." to stdout instead of failing loudly; it also
	 * exits 0 with EMPTY stdout (the error lands on stderr instead) when
	 * the file's signature isn't trusted by keysdir -- do not trust
	 * exit_code alone in either case. Treat anything other than a clean,
	 * non-empty run of "sha256:<hex>  <path>" lines as failure. */
	if(r->exit_code != 0 || r->out[0] == '\0' || strncmp(r->out, "ERROR:", 6) == 0)
	{
		fprintf(stderr, "apk_manifest: %s\n",
			(r->out[0] != '\0') ? r->out : r->err);
		apk_result_free(r);
		return NULL;
	}

	result = initialize_string_map(1);
	buf = safe_strdup(r->out);
	line = strtok_r(buf, "\n", &saveptr);
	while(line != NULL)
	{
		char* sep = strstr(line, "  ");
		if(sep != NULL)
		{
			*sep = '\0';
			set_string_map_element(result, sep + 2, safe_strdup(line));
		}
		line = strtok_r(NULL, "\n", &saveptr);
	}
	free(buf);
	apk_result_free(r);
	return result;
}


int apk_extract(const char* keysdir, const char* destdir, const char* file, int allow_untrusted)
{
	const char* argv[9];
	int i = 0;
	apk_result* r;
	int ok;

	argv[i++] = apk_bin_path();
	argv[i++] = "extract";
	if(keysdir != NULL) { argv[i++] = "--keys-dir"; argv[i++] = keysdir; }
	argv[i++] = "--destination";
	argv[i++] = destdir;
	if(allow_untrusted) { argv[i++] = "--allow-untrusted"; }
	argv[i++] = file;
	argv[i++] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return 0; }

	ok = (r->exit_code == 0);
	if(!ok)
	{
		fprintf(stderr, "apk_extract: %s\n", (r->err[0] != '\0') ? r->err : r->out);
	}
	apk_result_free(r);
	return ok;
}


int apk_add_mainroot(const char* root, const char* repo, const char* keysdir,
	const char* arch, int initdb, int usermode, int allow_untrusted, int local_file, const char* pkg)
{
	/* Max elements written below (all optional flags set): bin, add,
	 * --root, root, --keys-dir, keysdir, --repository, repo, --arch,
	 * arch, --initdb, --usermode, --allow-untrusted,
	 * --force-non-repository, pkg, NULL = 16. Sized with margin above
	 * that -- see the apk_extract/apk_update_mainroot stack-overflow
	 * finding in the Phase 5 progress notes for why this margin is
	 * deliberate, not decorative. */
	const char* argv[20];
	int i = 0;
	apk_result* r;
	int ok;

	argv[i++] = apk_bin_path();
	argv[i++] = "add";
	argv[i++] = "--root";
	argv[i++] = root;
	if(keysdir != NULL) { argv[i++] = "--keys-dir"; argv[i++] = keysdir; }
	if(repo != NULL) { argv[i++] = "--repository"; argv[i++] = repo; }
	if(arch != NULL) { argv[i++] = "--arch"; argv[i++] = arch; }
	if(initdb) { argv[i++] = "--initdb"; }
	if(usermode) { argv[i++] = "--usermode"; }
	if(allow_untrusted) { argv[i++] = "--allow-untrusted"; }
	if(local_file) { argv[i++] = "--force-non-repository"; }
	argv[i++] = pkg;
	argv[i++] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return 0; }

	ok = (r->exit_code == 0);
	if(!ok)
	{
		fprintf(stderr, "apk_add_mainroot: %s\n", (r->err[0] != '\0') ? r->err : r->out);
	}
	apk_result_free(r);
	return ok;
}


int apk_del_mainroot(const char* root, const char* pkg)
{
	const char* argv[6];
	apk_result* r;
	int ok;

	argv[0] = apk_bin_path();
	argv[1] = "del";
	argv[2] = "--root";
	argv[3] = root;
	argv[4] = pkg;
	argv[5] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return 0; }

	ok = (r->exit_code == 0);
	if(!ok)
	{
		fprintf(stderr, "apk_del_mainroot: %s\n", (r->err[0] != '\0') ? r->err : r->out);
	}
	apk_result_free(r);
	return ok;
}


json_value* apk_adbdump_json(const char* file)
{
	const char* argv[6];
	apk_result* r;
	json_value* result;

	argv[0] = apk_bin_path();
	argv[1] = "adbdump";
	argv[2] = "--format";
	argv[3] = "json";
	argv[4] = file;
	argv[5] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return NULL; }

	if(r->exit_code != 0)
	{
		fprintf(stderr, "apk_adbdump_json: %s\n", (r->err[0] != '\0') ? r->err : r->out);
		apk_result_free(r);
		return NULL;
	}

	result = json_parse(r->out);
	if(result == NULL)
	{
		fprintf(stderr, "apk_adbdump_json: could not parse apk output: %s\n",
			(r->err[0] != '\0') ? r->err : r->out);
	}
	apk_result_free(r);
	return result;
}


int apk_update_mainroot(const char* root, const char* repo, const char* keysdir)
{
	const char* argv[9];
	int i = 0;
	apk_result* r;
	int ok;

	argv[i++] = apk_bin_path();
	argv[i++] = "update";
	argv[i++] = "--root";
	argv[i++] = root;
	if(keysdir != NULL) { argv[i++] = "--keys-dir"; argv[i++] = keysdir; }
	if(repo != NULL) { argv[i++] = "--repository"; argv[i++] = repo; }
	argv[i++] = NULL;

	r = apk_run(argv);
	if(r == NULL) { return 0; }

	ok = (r->exit_code == 0);
	if(!ok)
	{
		fprintf(stderr, "apk_update_mainroot: %s\n", (r->err[0] != '\0') ? r->err : r->out);
	}
	apk_result_free(r);
	return ok;
}
