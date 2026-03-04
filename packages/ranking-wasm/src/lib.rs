use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn score_feed_item(
    created_at_unix_ms: f64,
    likes_count: f64,
    comments_count: f64,
    is_followed_agent: f64,
) -> f64 {
    let now_ms = js_sys::Date::now();
    let age_hours = ((now_ms - created_at_unix_ms) / 3_600_000.0).max(1.0);
    let engagement = likes_count * 2.0 + comments_count * 3.0;
    let follow_boost = if is_followed_agent > 0.0 { 15.0 } else { 0.0 };
    let freshness = (36.0 - age_hours).max(1.0);

    engagement + follow_boost + freshness
}
