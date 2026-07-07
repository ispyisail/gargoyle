/*
 * test_json_main.c -- standalone test driver for json.c (gapk Phase 1).
 * Not part of gpkg itself; built and run only by
 * tests/gapk/test-json.sh in the gargoyle-tools repo. Two modes:
 *
 *   test_json_main valid   <file>   -- must parse successfully
 *   test_json_main invalid <file>   -- must return NULL (json_parse failure)
 *   test_json_main checks           -- run the hardcoded structural
 *                                       assertions against the real
 *                                       captured apk-query corpus shapes
 *
 * Exit 0 on expected outcome, 1 otherwise, printing a one-line reason on
 * failure. Every parse (success or failure) frees whatever was allocated
 * -- run under valgrind by the shell wrapper to catch leaks/invalid
 * access, not just wrong answers.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "json.h"

static char* read_file(const char* path)
{
	FILE* f = fopen(path, "rb");
	long size;
	char* buf;
	size_t n;
	if(f == NULL) { return NULL; }
	fseek(f, 0, SEEK_END);
	size = ftell(f);
	fseek(f, 0, SEEK_SET);
	buf = (char*)malloc((size_t)size + 1);
	n = fread(buf, 1, (size_t)size, f);
	buf[n] = '\0';
	fclose(f);
	return buf;
}

static int run_checks(void)
{
	/* Structural assertions against the exact shapes captured from real
	 * apk output (see json-corpus/valid/recursive-bar.json and
	 * escapes-and-types.json) -- these pin down that json_get/
	 * json_arr_get/json_str/json_int/json_bool actually navigate a
	 * parsed tree correctly, not just that parsing succeeds. */
	json_value* root;
	json_value* pkg0;
	json_value* pkg1;
	json_value* deps;
	json_value* status;
	long i;
	int failures = 0;

	root = json_parse(
		"[{\"name\":\"bar\",\"version\":\"2.0-r0\",\"installed-size\":36,\"depends\":[\"libfoo\"]},"
		"{\"name\":\"libfoo\",\"version\":\"1.0-r0\",\"installed-size\":30,\"status\":[\"installed\"]}]"
	);
	if(root == NULL) { printf("FAIL: recursive-bar-shape: json_parse returned NULL\n"); return 1; }
	if(json_get_type(root) != JSON_ARRAY) { printf("FAIL: root is not an array\n"); failures++; }
	if(json_arr_len(root) != 2) { printf("FAIL: expected 2 array elements, got %lu\n", json_arr_len(root)); failures++; }

	pkg0 = json_arr_get(root, 0);
	if(strcmp(json_str(json_get(pkg0, "name")), "bar") != 0) { printf("FAIL: pkg0 name != bar\n"); failures++; }
	if(!json_int(json_get(pkg0, "installed-size"), &i) || i != 36) { printf("FAIL: pkg0 installed-size != 36\n"); failures++; }
	deps = json_get(pkg0, "depends");
	if(json_arr_len(deps) != 1 || strcmp(json_str(json_arr_get(deps, 0)), "libfoo") != 0) { printf("FAIL: pkg0 depends != [libfoo]\n"); failures++; }
	if(json_get(pkg0, "status") != NULL) { printf("FAIL: pkg0 should have no status field\n"); failures++; }

	pkg1 = json_arr_get(root, 1);
	status = json_get(pkg1, "status");
	if(json_arr_len(status) != 1 || strcmp(json_str(json_arr_get(status, 0)), "installed") != 0) { printf("FAIL: pkg1 status != [installed]\n"); failures++; }

	if(json_arr_get(root, 2) != NULL) { printf("FAIL: out-of-range array index should return NULL\n"); failures++; }
	if(json_get(pkg0, "nonexistent-field") != NULL) { printf("FAIL: missing object key should return NULL\n"); failures++; }

	json_free(root);

	/* escapes + types */
	root = json_parse(
		"{\"s\":\"a\\\"b\\\\c\\/d\\n\\t\",\"neg\":-42,\"zero\":0,\"t\":true,\"f\":false,\"n\":null,\"empty_arr\":[],\"empty_obj\":{}}"
	);
	if(root == NULL) { printf("FAIL: escapes-shape: json_parse returned NULL\n"); return 1 + failures; }
	if(strcmp(json_str(json_get(root, "s")), "a\"b\\c/d\n\t") != 0) { printf("FAIL: escape decoding wrong\n"); failures++; }
	if(!json_int(json_get(root, "neg"), &i) || i != -42) { printf("FAIL: negative int wrong\n"); failures++; }
	if(!json_int(json_get(root, "zero"), &i) || i != 0) { printf("FAIL: zero int wrong\n"); failures++; }
	{
		int b;
		if(!json_bool(json_get(root, "t"), &b) || b != 1) { printf("FAIL: true bool wrong\n"); failures++; }
		if(!json_bool(json_get(root, "f"), &b) || b != 0) { printf("FAIL: false bool wrong\n"); failures++; }
	}
	if(!json_is_null(json_get(root, "n"))) { printf("FAIL: null value not recognized\n"); failures++; }
	if(json_arr_len(json_get(root, "empty_arr")) != 0) { printf("FAIL: empty array length != 0\n"); failures++; }
	if(json_get_type(json_get(root, "empty_obj")) != JSON_OBJECT) { printf("FAIL: empty object type wrong\n"); failures++; }
	json_free(root);

	/* NULL-safety: every accessor must tolerate a NULL json_value* */
	if(json_get(NULL, "x") != NULL) { failures++; }
	if(json_arr_len(NULL) != 0) { failures++; }
	if(json_arr_get(NULL, 0) != NULL) { failures++; }
	if(json_str(NULL) != NULL) { failures++; }
	if(json_int(NULL, &i)) { failures++; }
	if(!json_is_null(NULL)) { failures++; }
	json_free(NULL); /* must not crash */

	if(failures == 0) { printf("PASS: all structural checks\n"); }
	return failures;
}

int main(int argc, char** argv)
{
	if(argc == 2 && strcmp(argv[1], "checks") == 0)
	{
		return run_checks();
	}
	if(argc == 3 && (strcmp(argv[1], "valid") == 0 || strcmp(argv[1], "invalid") == 0))
	{
		char* buf = read_file(argv[2]);
		json_value* val;
		int want_valid = strcmp(argv[1], "valid") == 0;
		int ok;

		if(buf == NULL)
		{
			fprintf(stderr, "could not read %s\n", argv[2]);
			return 1;
		}
		val = json_parse(buf);
		ok = want_valid ? (val != NULL) : (val == NULL);
		if(!ok)
		{
			fprintf(stderr, "FAIL: %s expected %s but got %s\n",
				argv[2], want_valid ? "success" : "failure", (val != NULL) ? "success" : "failure");
		}
		json_free(val);
		free(buf);
		return ok ? 0 : 1;
	}
	fprintf(stderr, "usage: %s valid|invalid <file>   OR   %s checks\n", argv[0], argv[0]);
	return 2;
}
