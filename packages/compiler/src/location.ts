/**
 * `location` is a free-text user hint. The real `query-nearby-stores` tool has
 * no `location` parameter — it takes `city` + `keyword` — so the compiler must
 * split the text before the adapter can call it (see dev brief §2.1 note).
 *
 * This is a documented heuristic, not a geocoder:
 *   北京市海淀区五道口  →  city=北京市, keyword=海淀区五道口
 *   深圳市南山区        →  city=深圳市, keyword=南山区
 *   北京 五道口         →  city=北京,   keyword=五道口
 *   五道口             →  city=五道口,  keyword=五道口
 */
export interface SplitLocation {
  city: string;
  keyword: string;
}

const MUNICIPALITY = /^(北京市|上海市|天津市|重庆市)/;
const GENERIC_CITY = /^([^市区县]{1,6}市)/;

export function splitLocation(raw: string): SplitLocation {
  const text = raw.trim();
  if (!text) return { city: '', keyword: '' };

  const municipality = MUNICIPALITY.exec(text);
  const generic = municipality ? null : GENERIC_CITY.exec(text);
  const matched = municipality ?? generic;

  if (matched?.[1]) {
    const city = matched[1];
    const rest = text.slice(city.length).trim();
    return { city, keyword: rest.length > 0 ? rest : city };
  }

  const parts = text.split(/\s+/);
  if (parts.length > 1 && parts[0]) {
    return { city: parts[0], keyword: parts.slice(1).join(' ') };
  }

  return { city: text, keyword: text };
}
