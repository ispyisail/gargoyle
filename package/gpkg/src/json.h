#ifndef JSON_H
#define JSON_H

/*
 * Minimal, dependency-free JSON reader for parsing apk-tools' own
 * `apk query --format json` output (see docs/gapk-implementation-plan.md
 * Phase 1 in the gargoyle-tools repo). Deliberately small: objects,
 * arrays, strings (with standard JSON escapes incl. \uXXXX), integers
 * (signed, no floats -- apk's own JSON fields this reader targets are
 * all integer/string/array/bool/null, never fractional), booleans, and
 * null. Never crashes on malformed input -- json_parse() returns NULL
 * for anything it can't fully parse, with no partial tree leaked.
 *
 * Internally reuses gpkg's own string_map (for objects) and list (for
 * arrays) container types instead of hand-rolling new ones -- both are
 * already used throughout the rest of gpkg, so this keeps json.c small
 * and avoids introducing a second, untested hash-map/dynamic-array
 * implementation into the codebase.
 */

typedef enum
{
	JSON_NULL,
	JSON_BOOL,
	JSON_INT,
	JSON_STRING,
	JSON_ARRAY,
	JSON_OBJECT
} json_type;

typedef struct json_value json_value;

/* Parse a NUL-terminated JSON document. Returns NULL if the input is not
 * a single well-formed JSON value (trailing garbage after the value is
 * also treated as malformed). Caller owns the returned tree and must
 * free it with json_free(). */
json_value* json_parse(const char* buf);

/* Recursively frees a json_value tree (safe to call with NULL). */
void json_free(json_value* val);

/* Type of a value; NULL input reports JSON_NULL type-safely (does not
 * dereference). */
json_type json_get_type(json_value* val);

/* Object field lookup by key. Returns NULL if val is NULL, not an
 * object, or the key is absent. */
json_value* json_get(json_value* val, const char* key);

/* Array length. Returns 0 if val is NULL or not an array. */
unsigned long json_arr_len(json_value* val);

/* Array element by index. Returns NULL if val is NULL, not an array, or
 * idx is out of range. */
json_value* json_arr_get(json_value* val, unsigned long idx);

/* String value accessor. Returns NULL if val is NULL or not a string.
 * The returned pointer is owned by the json_value and is only valid
 * until json_free() is called on the tree containing it. */
const char* json_str(json_value* val);

/* Integer value accessor. Returns 1 and writes *out on success; returns
 * 0 (and leaves *out untouched) if val is NULL or not an integer. */
int json_int(json_value* val, long* out);

/* Boolean value accessor. Returns 1 and writes *out (0 or 1) on success;
 * returns 0 (and leaves *out untouched) if val is NULL or not a bool. */
int json_bool(json_value* val, int* out);

/* True (non-zero) if val is a JSON null (or the NULL C pointer itself --
 * both are treated as "no value" by callers). */
int json_is_null(json_value* val);

#endif
