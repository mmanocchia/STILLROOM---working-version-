import { sql, type SQL } from "drizzle-orm";

const aliases = {
  Music: ["music", "musician", "singer", "songwriter", "composer", "sound"],
  Film: ["film", "filmmaker", "cinema", "cinematographer", "director"],
  Photography: ["photography", "photographer", "photo"],
  Painting: ["painting", "painter"],
  Fashion: ["fashion", "clothing", "textile"],
};

export function categoryCondition(column: SQL, category?: string) {
  if (!category) return sql`true`;
  const known = category === "Other" ? Object.values(aliases).flat() : aliases[category as keyof typeof aliases];
  if (!known) return sql`false`;
  const pattern = `(^|[^a-z])(${known.join("|")})([^a-z]|$)`;
  return category === "Other" ? sql`not (${column} ~* ${pattern})` : sql`${column} ~* ${pattern}`;
}

export function searchTerms(query = "") {
  return query.trim().replaceAll("@", "").split(/\s+/).filter(Boolean);
}

// Native PostgreSQL prefix full-text search: no paid service or extension needed.
export function textMatch(document: SQL, term: string) {
  return sql`to_tsvector('simple', ${document}) @@ to_tsquery('simple',
    (select string_agg(quote_literal(lexeme) || ':*', ' & ')
      from unnest(tsvector_to_array(to_tsvector('simple', ${term}))) as lexeme))`;
}
