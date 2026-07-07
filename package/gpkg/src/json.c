/* Deliberately includes erics_tools.h directly rather than gpkg.h --
 * json.c only needs string_map/list, not gpkg.h's much larger surface
 * (opkg_conf, LOAD_* enums, bbtargz.h/ewget.h transitively). This keeps
 * json.c buildable and unit-testable (tests/gapk/test-json.sh) against
 * just libericstools, with no gpkg-specific or apk-subprocess
 * dependencies at all. */
#include <erics_tools.h>
#include "json.h"

#include <stdlib.h>
#include <string.h>
#include <ctype.h>

/* JSON_OBJECT stores values in a string_map (key -> json_value*, keys
 * owned/copied by the map per gpkg's usual set_string_map_element
 * convention). JSON_ARRAY stores values in a list (each element a
 * json_value*). JSON_STRING owns a malloc'd, NUL-terminated buffer.
 */
struct json_value
{
	json_type type;
	union
	{
		int b;
		long i;
		char* s;
		list* arr;
		string_map* obj;
	} v;
};

typedef struct
{
	const char* buf;
	unsigned long pos;
	unsigned long len;
	int failed;
} json_parser;

static void json_skip_ws(json_parser* p)
{
	while(p->pos < p->len && (p->buf[p->pos] == ' ' || p->buf[p->pos] == '\t' || p->buf[p->pos] == '\n' || p->buf[p->pos] == '\r'))
	{
		p->pos++;
	}
}

static int json_peek(json_parser* p)
{
	if(p->pos >= p->len) { return -1; }
	return (unsigned char)p->buf[p->pos];
}

static int json_match(json_parser* p, char c)
{
	if(p->pos < p->len && p->buf[p->pos] == c)
	{
		p->pos++;
		return 1;
	}
	return 0;
}

static json_value* json_alloc(json_type type)
{
	json_value* val = (json_value*)malloc(sizeof(json_value));
	val->type = type;
	return val;
}

static void json_free_value_func(char* key, void* value)
{
	(void)key;
	json_free((json_value*)value);
}

void json_free(json_value* val)
{
	unsigned long num_destroyed;
	if(val == NULL) { return; }
	switch(val->type)
	{
		case JSON_STRING:
			free(val->v.s);
			break;
		case JSON_ARRAY:
		{
			unsigned long num_values;
			void** values = get_list_values(val->v.arr, &num_values);
			unsigned long i;
			for(i = 0; i < num_values; i++)
			{
				json_free((json_value*)values[i]);
			}
			free(values);
			destroy_list(val->v.arr, DESTROY_MODE_IGNORE_VALUES, &num_destroyed);
			break;
		}
		case JSON_OBJECT:
			apply_to_every_string_map_value(val->v.obj, json_free_value_func);
			destroy_string_map(val->v.obj, DESTROY_MODE_IGNORE_VALUES, &num_destroyed);
			break;
		default:
			break;
	}
	free(val);
}

/* Appends one decoded Unicode code point (from a \uXXXX escape) to a
 * growable buffer as UTF-8. apk's own JSON output (docs/gapk-*.md) never
 * actually needs this in practice, but real JSON permits it, and a
 * parser that chokes on a valid escape it doesn't expect is exactly the
 * kind of "silently wrong" failure this reader must not have. Surrogate
 * pairs are handled by the caller (json_parse_string) re-invoking this
 * per code unit; a lone unpaired surrogate is encoded as the UTF-8
 * replacement character rather than failing the whole parse.
 */
static void json_append_utf8(char** buf, unsigned long* len, unsigned long* cap, unsigned long codepoint)
{
	char enc[4];
	int enc_len = 0;
	if(codepoint <= 0x7F)
	{
		enc[0] = (char)codepoint;
		enc_len = 1;
	}
	else if(codepoint <= 0x7FF)
	{
		enc[0] = (char)(0xC0 | (codepoint >> 6));
		enc[1] = (char)(0x80 | (codepoint & 0x3F));
		enc_len = 2;
	}
	else if(codepoint <= 0xFFFF)
	{
		enc[0] = (char)(0xE0 | (codepoint >> 12));
		enc[1] = (char)(0x80 | ((codepoint >> 6) & 0x3F));
		enc[2] = (char)(0x80 | (codepoint & 0x3F));
		enc_len = 3;
	}
	else
	{
		enc[0] = (char)(0xF0 | (codepoint >> 18));
		enc[1] = (char)(0x80 | ((codepoint >> 12) & 0x3F));
		enc[2] = (char)(0x80 | ((codepoint >> 6) & 0x3F));
		enc[3] = (char)(0x80 | (codepoint & 0x3F));
		enc_len = 4;
	}
	while(*len + (unsigned long)enc_len + 1 > *cap)
	{
		*cap = (*cap == 0) ? 64 : (*cap * 2);
		*buf = (char*)realloc(*buf, *cap);
	}
	memcpy(*buf + *len, enc, (size_t)enc_len);
	*len += (unsigned long)enc_len;
}

static int json_hex4(json_parser* p, unsigned long* out)
{
	unsigned long val = 0;
	int i;
	if(p->pos + 4 > p->len) { return 0; }
	for(i = 0; i < 4; i++)
	{
		int c = (unsigned char)p->buf[p->pos + (unsigned long)i];
		val <<= 4;
		if(c >= '0' && c <= '9') { val |= (unsigned long)(c - '0'); }
		else if(c >= 'a' && c <= 'f') { val |= (unsigned long)(c - 'a' + 10); }
		else if(c >= 'A' && c <= 'F') { val |= (unsigned long)(c - 'A' + 10); }
		else { return 0; }
	}
	p->pos += 4;
	*out = val;
	return 1;
}

/* Parses a JSON string, cursor already past the opening quote. Returns
 * a malloc'd, NUL-terminated buffer, or NULL on any malformed escape /
 * unterminated string / raw control character (real JSON forbids
 * unescaped control characters inside strings). */
static char* json_parse_string_body(json_parser* p)
{
	char* buf = NULL;
	unsigned long len = 0;
	unsigned long cap = 0;

	for(;;)
	{
		int c;
		if(p->pos >= p->len) { free(buf); return NULL; }
		c = (unsigned char)p->buf[p->pos];
		if(c == '"')
		{
			p->pos++;
			if(buf == NULL)
			{
				buf = (char*)malloc(1);
				len = 0;
			}
			buf[len] = '\0';
			return buf;
		}
		else if(c == '\\')
		{
			int esc;
			p->pos++;
			if(p->pos >= p->len) { free(buf); return NULL; }
			esc = (unsigned char)p->buf[p->pos];
			p->pos++;
			switch(esc)
			{
				case '"':  json_append_utf8(&buf, &len, &cap, '"');  break;
				case '\\': json_append_utf8(&buf, &len, &cap, '\\'); break;
				case '/':  json_append_utf8(&buf, &len, &cap, '/');  break;
				case 'b':  json_append_utf8(&buf, &len, &cap, '\b'); break;
				case 'f':  json_append_utf8(&buf, &len, &cap, '\f'); break;
				case 'n':  json_append_utf8(&buf, &len, &cap, '\n'); break;
				case 'r':  json_append_utf8(&buf, &len, &cap, '\r'); break;
				case 't':  json_append_utf8(&buf, &len, &cap, '\t'); break;
				case 'u':
				{
					unsigned long cp;
					if(!json_hex4(p, &cp)) { free(buf); return NULL; }
					if(cp >= 0xD800 && cp <= 0xDBFF)
					{
						/* high surrogate -- expect a following \uDCxx low surrogate */
						unsigned long lo;
						if(p->pos + 2 > p->len || p->buf[p->pos] != '\\' || p->buf[p->pos + 1] != 'u')
						{
							json_append_utf8(&buf, &len, &cap, 0xFFFD);
							break;
						}
						p->pos += 2;
						if(!json_hex4(p, &lo) || lo < 0xDC00 || lo > 0xDFFF)
						{
							json_append_utf8(&buf, &len, &cap, 0xFFFD);
							break;
						}
						json_append_utf8(&buf, &len, &cap, 0x10000UL + ((cp - 0xD800UL) << 10) + (lo - 0xDC00UL));
					}
					else
					{
						json_append_utf8(&buf, &len, &cap, cp);
					}
					break;
				}
				default:
					free(buf);
					return NULL;
			}
		}
		else if(c < 0x20)
		{
			/* unescaped control character -- not valid JSON */
			free(buf);
			return NULL;
		}
		else
		{
			json_append_utf8(&buf, &len, &cap, (unsigned long)c);
			p->pos++;
		}
	}
}

static json_value* json_parse_value(json_parser* p);

static json_value* json_parse_string(json_parser* p)
{
	json_value* val;
	char* s;
	p->pos++; /* opening quote already confirmed by caller */
	s = json_parse_string_body(p);
	if(s == NULL) { return NULL; }
	val = json_alloc(JSON_STRING);
	val->v.s = s;
	return val;
}

static json_value* json_parse_number(json_parser* p)
{
	unsigned long start = p->pos;
	long sign = 1;
	long result = 0;
	int have_digit = 0;
	json_value* val;

	if(json_peek(p) == '-')
	{
		sign = -1;
		p->pos++;
	}
	while(p->pos < p->len && isdigit((unsigned char)p->buf[p->pos]))
	{
		result = result * 10 + (p->buf[p->pos] - '0');
		p->pos++;
		have_digit = 1;
	}
	if(!have_digit) { p->pos = start; return NULL; }
	/* This reader deliberately has no float support (per
	 * docs/gapk-implementation-plan.md Phase 1's own scope) -- a
	 * fractional or exponent part here means the input isn't something
	 * this reader can represent; fail cleanly rather than silently
	 * truncating a value into an int. */
	if(p->pos < p->len && (p->buf[p->pos] == '.' || p->buf[p->pos] == 'e' || p->buf[p->pos] == 'E'))
	{
		p->pos = start;
		return NULL;
	}
	val = json_alloc(JSON_INT);
	val->v.i = sign * result;
	return val;
}

static json_value* json_parse_literal(json_parser* p, const char* lit, unsigned long lit_len, json_value* on_success)
{
	if(p->pos + lit_len > p->len) { return NULL; }
	if(memcmp(p->buf + p->pos, lit, (size_t)lit_len) != 0) { return NULL; }
	p->pos += lit_len;
	return on_success;
}

static json_value* json_parse_array(json_parser* p)
{
	json_value* val = json_alloc(JSON_ARRAY);
	val->v.arr = initialize_list();
	p->pos++; /* '[' already confirmed */
	json_skip_ws(p);
	if(json_match(p, ']'))
	{
		return val;
	}
	for(;;)
	{
		json_value* elem;
		json_skip_ws(p);
		elem = json_parse_value(p);
		if(elem == NULL) { json_free(val); return NULL; }
		push_list(val->v.arr, elem);
		json_skip_ws(p);
		if(json_match(p, ',')) { continue; }
		if(json_match(p, ']')) { break; }
		json_free(val);
		return NULL;
	}
	return val;
}

static json_value* json_parse_object(json_parser* p)
{
	json_value* val = json_alloc(JSON_OBJECT);
	val->v.obj = initialize_string_map(1);
	p->pos++; /* '{' already confirmed */
	json_skip_ws(p);
	if(json_match(p, '}'))
	{
		return val;
	}
	for(;;)
	{
		char* key;
		json_value* elem;
		void* old;
		json_skip_ws(p);
		if(json_peek(p) != '"') { json_free(val); return NULL; }
		p->pos++;
		key = json_parse_string_body(p);
		if(key == NULL) { json_free(val); return NULL; }
		json_skip_ws(p);
		if(!json_match(p, ':')) { free(key); json_free(val); return NULL; }
		json_skip_ws(p);
		elem = json_parse_value(p);
		if(elem == NULL) { free(key); json_free(val); return NULL; }
		old = set_string_map_element(val->v.obj, key, elem);
		if(old != NULL) { json_free((json_value*)old); } /* duplicate key -- last one wins */
		free(key);
		json_skip_ws(p);
		if(json_match(p, ',')) { continue; }
		if(json_match(p, '}')) { break; }
		json_free(val);
		return NULL;
	}
	return val;
}

static json_value* json_parse_value(json_parser* p)
{
	int c;
	json_skip_ws(p);
	c = json_peek(p);
	switch(c)
	{
		case '"': return json_parse_string(p);
		case '{': return json_parse_object(p);
		case '[': return json_parse_array(p);
		case 't':
		{
			json_value* v = json_alloc(JSON_BOOL);
			v->v.b = 1;
			if(json_parse_literal(p, "true", 4, v) == NULL) { free(v); return NULL; }
			return v;
		}
		case 'f':
		{
			json_value* v = json_alloc(JSON_BOOL);
			v->v.b = 0;
			if(json_parse_literal(p, "false", 5, v) == NULL) { free(v); return NULL; }
			return v;
		}
		case 'n':
		{
			json_value* v = json_alloc(JSON_NULL);
			if(json_parse_literal(p, "null", 4, v) == NULL) { free(v); return NULL; }
			return v;
		}
		default:
			if(c == '-' || (c >= '0' && c <= '9'))
			{
				return json_parse_number(p);
			}
			return NULL;
	}
}

json_value* json_parse(const char* buf)
{
	json_parser p;
	json_value* val;

	if(buf == NULL) { return NULL; }

	p.buf = buf;
	p.pos = 0;
	p.len = (unsigned long)strlen(buf);
	p.failed = 0;

	val = json_parse_value(&p);
	if(val == NULL) { return NULL; }

	json_skip_ws(&p);
	if(p.pos != p.len)
	{
		/* trailing garbage after the value -- not a single well-formed
		 * JSON document */
		json_free(val);
		return NULL;
	}
	return val;
}

json_type json_get_type(json_value* val)
{
	if(val == NULL) { return JSON_NULL; }
	return val->type;
}

json_value* json_get(json_value* val, const char* key)
{
	if(val == NULL || val->type != JSON_OBJECT) { return NULL; }
	return (json_value*)get_string_map_element(val->v.obj, key);
}

unsigned long json_arr_len(json_value* val)
{
	if(val == NULL || val->type != JSON_ARRAY) { return 0; }
	return (unsigned long)val->v.arr->length;
}

json_value* json_arr_get(json_value* val, unsigned long idx)
{
	unsigned long num_values;
	void** values;
	json_value* ret;
	if(val == NULL || val->type != JSON_ARRAY) { return NULL; }
	if(idx >= (unsigned long)val->v.arr->length) { return NULL; }
	values = get_list_values(val->v.arr, &num_values);
	ret = (idx < num_values) ? (json_value*)values[idx] : NULL;
	free(values);
	return ret;
}

const char* json_str(json_value* val)
{
	if(val == NULL || val->type != JSON_STRING) { return NULL; }
	return val->v.s;
}

int json_int(json_value* val, long* out)
{
	if(val == NULL || val->type != JSON_INT) { return 0; }
	*out = val->v.i;
	return 1;
}

int json_bool(json_value* val, int* out)
{
	if(val == NULL || val->type != JSON_BOOL) { return 0; }
	*out = val->v.b;
	return 1;
}

int json_is_null(json_value* val)
{
	return (val == NULL || val->type == JSON_NULL) ? 1 : 0;
}
