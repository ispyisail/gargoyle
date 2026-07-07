/*
 * test_apkexec_main.c -- standalone test driver for apkexec.c (gapk
 * Phase 2). Not part of gpkg itself; built and run only by
 * tests/gapk/test-apkexec.sh in the gargoyle-tools repo, against the
 * lab built by tests/gapk/make-apk-lab.sh.
 *
 * Single mode: `test_apkexec_main checks <lab-dir>` -- runs a fixed set
 * of assertions against that lab's known fixture content (mainroot with
 * libfoo pre-installed, repo with libfoo+bar signed packages, bar
 * depends on libfoo and carries a post-install script, empty
 * pluginroot). Exit 0 and prints nothing but a final summary line if
 * everything passes; otherwise prints one "FAIL: ..." line per failure
 * and exits with the failure count.
 */

#include <erics_tools.h>
#include <unistd.h>
#include <sys/stat.h>

#include "json.h"
#include "apkexec.h"

static int failures = 0;

static void fail(const char* what)
{
	printf("FAIL: %s\n", what);
	failures++;
}

static int file_exists(const char* path)
{
	struct stat st;
	return stat(path, &st) == 0;
}

int main(int argc, char** argv)
{
	char* lab;
	char* mainroot;
	char* repo;
	char* keys;
	char* pluginroot;
	char* fetchout;
	char* bar_apk;
	char* tmproot;

	if(argc != 3 || strcmp(argv[1], "checks") != 0)
	{
		fprintf(stderr, "usage: %s checks <lab-dir>\n", argv[0]);
		return 2;
	}
	lab = argv[2];

	mainroot = dynamic_strcat(2, lab, "/mainroot");
	repo = dynamic_strcat(2, lab, "/repo/APKINDEX.adb");
	keys = dynamic_strcat(2, lab, "/keys");
	pluginroot = dynamic_strcat(2, lab, "/pluginroot");
	fetchout = dynamic_strcat(2, lab, "/fetchout");
	bar_apk = dynamic_strcat(2, lab, "/repo/bar-2.0-r0.apk");

	/* --- apk_query_json: recursive closure of "bar" ---------------- */
	{
		json_value* root = apk_query_json(mainroot, repo, keys, 1,
			"name,version,installed-size,depends,status", "bar");
		if(root == NULL)
		{
			fail("query: apk_query_json returned NULL");
		}
		else
		{
			unsigned long i;
			int saw_bar = 0, saw_libfoo_installed = 0;

			if(json_get_type(root) != JSON_ARRAY)
			{
				fail("query: root is not an array");
			}
			if(json_arr_len(root) != 2)
			{
				fail("query: expected 2 transitive members (bar + libfoo)");
			}
			for(i = 0; i < json_arr_len(root); i++)
			{
				json_value* member = json_arr_get(root, i);
				const char* name = json_str(json_get(member, "name"));

				if(name != NULL && strcmp(name, "bar") == 0) { saw_bar = 1; }
				if(name != NULL && strcmp(name, "libfoo") == 0)
				{
					json_value* status = json_get(member, "status");
					if(status != NULL && json_arr_len(status) >= 1 &&
						strcmp(json_str(json_arr_get(status, 0)), "installed") == 0)
					{
						saw_libfoo_installed = 1;
					}
				}
			}
			if(!saw_bar) { fail("query: bar not present in transitive closure"); }
			if(!saw_libfoo_installed) { fail("query: libfoo not reported as status:installed"); }
			json_free(root);
		}
	}

	/* --- apk_query_json: no-match is an empty array, not NULL ------- */
	{
		json_value* root = apk_query_json(mainroot, repo, keys, 1, "name", "nonexistent-pkg-xyz");
		if(root == NULL)
		{
			fail("query-nomatch: apk_query_json returned NULL for a no-match world");
		}
		else
		{
			if(json_get_type(root) != JSON_ARRAY || json_arr_len(root) != 0)
			{
				fail("query-nomatch: expected an empty array");
			}
			json_free(root);
		}
	}

	/* --- apk_fetch: fresh + idempotent re-fetch --------------------- */
	{
		char* p1 = apk_fetch(mainroot, repo, keys, fetchout, "bar");
		char* p2;

		if(p1 == NULL)
		{
			fail("fetch: fresh fetch returned NULL");
		}
		else if(!file_exists(p1))
		{
			fail("fetch: fresh fetch returned a path that doesn't exist");
		}

		p2 = apk_fetch(mainroot, repo, keys, fetchout, "bar");
		if(p2 == NULL)
		{
			fail("fetch: idempotent re-fetch returned NULL");
		}
		else if(!file_exists(p2))
		{
			fail("fetch: idempotent re-fetch returned a path that doesn't exist");
		}

		free_if_not_null(p1);
		free_if_not_null(p2);
	}

	/* --- apk_manifest: real file (bar has exactly 2 files) ---------- */
	{
		string_map* m = apk_manifest(mainroot, keys, bar_apk, 0);
		if(m == NULL)
		{
			fail("manifest: apk_manifest returned NULL for a real file");
		}
		else
		{
			unsigned long n;
			void** vals = get_string_map_values(m, &n);
			if(n != 2)
			{
				fail("manifest: expected exactly 2 files for bar");
			}
			if(get_string_map_element(m, "usr/bin/bar") == NULL)
			{
				fail("manifest: missing usr/bin/bar entry");
			}
			if(get_string_map_element(m, "usr/share/bar/data") == NULL)
			{
				fail("manifest: missing usr/share/bar/data entry");
			}
			free_if_not_null(vals);
			{
				unsigned long ndestroyed;
				destroy_string_map(m, DESTROY_MODE_FREE_VALUES, &ndestroyed);
			}
		}
	}

	/* --- apk_manifest: nonexistent file must fail cleanly ----------- */
	{
		char* bogus = dynamic_strcat(2, lab, "/does-not-exist.apk");
		string_map* m = apk_manifest(mainroot, keys, bogus, 0);
		if(m != NULL)
		{
			unsigned long ndestroyed;
			fail("manifest-missing: expected NULL for a nonexistent input file");
			destroy_string_map(m, DESTROY_MODE_FREE_VALUES, &ndestroyed);
		}
		free(bogus);
	}

	/* --- apk_extract: db-less, script-less placement into pluginroot - */
	{
		char* script_log = dynamic_strcat(2, lab, "/script-log-extract");
		int ok;

		unlink(script_log);
		setenv("GPKG_GOLDEN_SCRIPT_LOG", script_log, 1);

		ok = apk_extract(keys, pluginroot, bar_apk, 0);
		if(!ok)
		{
			fail("extract: apk_extract reported failure");
		}
		else
		{
			char* placed_bin = dynamic_strcat(2, pluginroot, "/usr/bin/bar");
			char* placed_data = dynamic_strcat(2, pluginroot, "/usr/share/bar/data");
			char* db_dir = dynamic_strcat(2, pluginroot, "/lib/apk");

			if(!file_exists(placed_bin)) { fail("extract: usr/bin/bar not placed"); }
			if(!file_exists(placed_data)) { fail("extract: usr/share/bar/data not placed"); }
			if(file_exists(db_dir)) { fail("extract: unexpectedly created lib/apk db in a db-less extract"); }
			if(file_exists(script_log)) { fail("extract: post-install script ran during a db-less extract"); }

			free(placed_bin);
			free(placed_data);
			free(db_dir);
		}
		free(script_log);
	}

	/* --- apk_add_mainroot / apk_del_mainroot on a scratch root -------
	 * Uses libfoo, not bar: bar's post-install script needs apk's
	 * script sandbox (unshare()), which this dev sandbox itself denies
	 * (CAP_SYS_ADMIN/user-namespace restriction, unrelated to apkexec.c
	 * -- a real router target has no such restriction). libfoo has no
	 * scripts, so it exercises add/del's own success/failure paths
	 * without depending on script-sandboxing working in THIS
	 * environment. */
	{
		int ok;
		tmproot = dynamic_strcat(2, lab, "/scratchroot");
		rm_r(tmproot);
		mkdir_p(tmproot, 0755);

		ok = apk_add_mainroot(tmproot, repo, keys, "x86_64", 1, 1, 0, 0, "libfoo");
		if(!ok)
		{
			fail("add_mainroot: fresh initdb+usermode add of libfoo failed");
		}
		else
		{
			char* placed = dynamic_strcat(2, tmproot, "/usr/lib/libfoo.so.1");
			if(!file_exists(placed)) { fail("add_mainroot: libfoo's files not present after add"); }
			free(placed);
		}

		ok = apk_del_mainroot(tmproot, "libfoo");
		if(!ok) { fail("del_mainroot: removing libfoo failed"); }

		ok = apk_del_mainroot(tmproot, "nonexistent-pkg-xyz");
		if(ok) { fail("del_mainroot: removing a nonexistent package unexpectedly succeeded"); }
	}

	/* --- apk_add_mainroot with local_file=1 (Phase 6's local-.apk-file
	 * install support) -- installs baz's raw .apk file directly by path,
	 * not by name/repo lookup, matching a user handing gpkg a package
	 * file directly. Reuses libfoo's absence of scripts reasoning: baz
	 * is also script-free, so this isolates local_file's own new
	 * --force-non-repository/--allow-untrusted wiring from the unrelated
	 * script-sandbox limitation above. */
	{
		int ok;
		char* baz_apk = dynamic_strcat(2, lab, "/repo/baz-1.0-r0.apk");

		ok = apk_add_mainroot(tmproot, NULL, keys, "x86_64", 0, 1, 1, 1, baz_apk);
		if(!ok)
		{
			fail("add_mainroot: local_file=1 add of baz's .apk path failed");
		}
		else
		{
			char* placed = dynamic_strcat(2, tmproot, "/usr/bin/baz");
			if(!file_exists(placed)) { fail("add_mainroot: local_file=1 baz's files not present after add"); }
			free(placed);
		}
		free(baz_apk);
	}

	free(mainroot); free(repo); free(keys); free(pluginroot);
	free(fetchout); free(bar_apk); free(tmproot);

	if(failures == 0)
	{
		printf("PASS: all apkexec checks\n");
	}
	return failures;
}
