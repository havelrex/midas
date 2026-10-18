import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuery, createSerpApi, ListingsError, parseShipping, pickProduct, pickWalmartProduct, toProductDetail, toShoppingItem, toWalmartReviews } from '../src/listings/serpapi.js';

// Shapes copied from real google_shopping and google_immersive_product responses.
const rawBestBuy = { title: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', source: 'Best Buy', price: '$228.00', extracted_price: 228,
  rating: 4.6, reviews: 18000, delivery: 'Free delivery', multiple_sources: true, product_link: 'https://www.google.com/search?ibp=oshop&q=x',
  immersive_product_page_token: 'tok-bb' };
const rawUsed = { title: 'Sony Wh-1000xm5 Black', source: 'eBay - someone', extracted_price: 523.78, second_hand_condition: 'pre-owned', immersive_product_page_token: 't2' };
const rawNoPrice = { title: 'No price', source: 'X' };
const rawDetail = { product_results: { rating: 4.6, reviews: 17818,
  ratings: [{ stars: 1, amount: 10 }, { stars: 2, amount: 8 }, { stars: 3, amount: 70 }, { stars: 4, amount: 900 }, { stars: 5, amount: 16830 }],
  user_reviews: [{ title: 't', text: 'Broke after 4 months', rating: 1, user_name: 'a' }, { text: 'Love', rating: 5 }, { text: 'no rating' }] } };

test('shopping results normalize to the Listing contract', () => {
  const item = toShoppingItem(rawBestBuy)!;
  assert.deepEqual(item.listing, { source: 'serpapi', merchant: 'Best Buy', title: rawBestBuy.title, price: 228, shipping: 0,
    url: rawBestBuy.product_link, sellerRating: null, condition: 'new' });
  assert.deepEqual([item.avg, item.n, item.token], [4.6, 18000, 'tok-bb']);
  assert.equal(toShoppingItem(rawUsed)!.listing.condition, 'used');
  assert.equal(toShoppingItem({ ...rawUsed, second_hand_condition: 'Refurbished' })!.listing.condition, 'refurbished');
  assert.equal(toShoppingItem(rawNoPrice), null);
});

test('shipping is parsed from the delivery text', () => {
  assert.equal(parseShipping('Free delivery by Tue'), 0);
  assert.equal(parseShipping('$5.99 delivery'), 5.99);
  assert.equal(parseShipping('+$1,200.50 shipping'), 1200.5);
  assert.equal(parseShipping(undefined), 0);
});

test('product detail yields the star breakdown and owner reviews', () => {
  const d = toProductDetail(rawDetail)!;
  assert.deepEqual(d.breakdown, { 5: 16830, 4: 900, 3: 70, 2: 8, 1: 10 });
  assert.deepEqual(d.reviews, [{ rating: 1, text: 'Broke after 4 months' }, { rating: 5, text: 'Love' }]);
  assert.equal(toProductDetail({ product_results: { rating: 4, reviews: 3, ratings: [{ stars: 5, amount: 3 }] } })!.breakdown, null);
  assert.equal(toProductDetail({}), null);
});

test('product pick: new, model in title, most reviews', () => {
  const items = [rawBestBuy, rawUsed, { ...rawBestBuy, source: 'Other', reviews: 12, immersive_product_page_token: 'tok-other' },
    { ...rawBestBuy, title: 'Sony WH-1000XM6', immersive_product_page_token: 'tok-xm6', reviews: 99999 }]
    .map((r) => toShoppingItem(r)!);
  assert.equal(pickProduct(items, 'WH-1000XM5')?.token, 'tok-bb');
  assert.equal(pickProduct(items, 'ZZ-9'), null);
});

test('query adds the category so real retailers come back', () => {
  assert.equal(buildQuery({ brand: 'Sony', model: 'WH-1000XM5', category: 'Headphones', name: 'x' }), 'Sony WH-1000XM5 Headphones');
  assert.equal(buildQuery({ brand: 'Sony', model: '', category: 'Headphones', name: 'Sony over-ear headphones' }), 'Sony over-ear headphones');
});

test('client sends the key server-side and maps errors without leaking the URL', async () => {
  assert.equal(createSerpApi({}), undefined);
  let seen = '';
  const ok = createSerpApi({ apiKey: 'secret-key', fetcher: async (url) => { seen = String(url); return Response.json({ shopping_results: [rawBestBuy, rawNoPrice] }); } })!;
  const items = await ok.searchShopping('Sony WH-1000XM5 Headphones');
  assert.equal(items.length, 1);
  assert.match(seen, /engine=google_shopping/);
  assert.match(seen, /q=Sony\+WH-1000XM5\+Headphones/);
  const bad = createSerpApi({ apiKey: 'secret-key', fetcher: async () => new Response('no', { status: 500 }) })!;
  await assert.rejects(bad.searchShopping('x'), (e: unknown) => e instanceof ListingsError && e.status === 502 && !e.message.includes('secret-key'));
  const limited = createSerpApi({ apiKey: 'k', fetcher: async () => new Response('', { status: 429 }) })!;
  await assert.rejects(limited.searchShopping('x'), (e: unknown) => e instanceof ListingsError && e.status === 429);
  const empty = createSerpApi({ apiKey: 'k', fetcher: async () => Response.json({ error: "Google hasn't returned any results for this query." }) })!;
  assert.deepEqual(await empty.searchShopping('x'), []);
});

test('review source: main cards only, median rating, trusted card closest to it', () => {
  const card = (merchant: string, avg: number, n: number, token: string) =>
    toShoppingItem({ ...rawBestBuy, source: merchant, rating: avg, reviews: n, immersive_product_page_token: token })!;
  const items = [card('eBay - seller', 3.7, 16000, 'ebay'), card('Walmart', 4.6, 16000, 'walmart'), card('Mercari', 5, 15000, 'merc'),
    card('Adorama', 4.1, 22, 'tiny'), card('Costco', 4.5, 9000, 'costco'), card('Some Shop', 4.4, 12000, 'shop')];
  // main cards (n >= 8000): ratings 3.7, 4.4, 4.5, 4.6, 5 -> median 4.5, which is Costco's own rating
  assert.equal(pickProduct(items, 'WH-1000XM5', ['Walmart', 'Costco', 'Adorama'])?.token, 'costco');
  assert.equal(pickProduct(items, 'WH-1000XM5', ['Walmart'])?.token, 'walmart'); // only trusted main card, even if off the median
  assert.notEqual(pickProduct(items, 'WH-1000XM5', ['Adorama'])?.token, 'tiny'); // a tiny trusted card never wins
  assert.equal(pickProduct(items, 'WH-1000XM5')?.token, 'costco'); // no trusted list: closest to the median, any main card
  assert.equal(pickProduct([card('eBay - seller', 3.7, 16000, 'ebay')], 'WH-1000XM5', ['Walmart'])?.token, 'ebay'); // only card
  assert.equal(pickProduct([], 'WH-1000XM5'), null);
});

test('Walmart product: matches the model, skips restored/open-box, takes the most ratings', () => {
  const rows = [
    { us_item_id: 1, title: 'Restored Apple AirPods Max - Green', reviews: 900 },
    { us_item_id: 2, title: 'Apple AirPods Max USB-C Over-Ear Headphones', reviews: 2503 },
    { us_item_id: 3, title: 'AirPods Max 2 - Midnight', reviews: 1109 },
    { us_item_id: 4, title: 'Sony WH-1000XM5', reviews: 9000 },
    { us_item_id: 5, title: 'Open Box Apple AirPods Max', reviews: 3000 },
    { us_item_id: 6, title: 'Apple AirPods Max Case', reviews: 0 },
  ];
  assert.equal(pickWalmartProduct(rows, 'AirPods Max'), '2');
  assert.equal(pickWalmartProduct(rows, 'ZZ-9'), null);
});

test('Walmart reviews: keeps rating and text, joins the title, drops blanks and duplicates', () => {
  const out = toWalmartReviews([
    { rating: 1, title: 'Broke', text: 'Left cup stopped working after 3 months' },
    { rating: 1, title: 'Broke', text: 'Left cup stopped working after 3 months' },
    { rating: 5, text: 'Still perfect after two years' },
    { rating: 3, text: '   ' }, { rating: 9, text: 'bad rating' }, { text: 'no rating' },
  ]);
  assert.deepEqual(out, [{ rating: 1, text: 'Broke. Left cup stopped working after 3 months' }, { rating: 5, text: 'Still perfect after two years' }]);
});

test('productReviews asks Walmart for the lowest- and highest-rated pages and returns merged reviews', async () => {
  const calls: string[] = [];
  const serp = createSerpApi({ apiKey: 'k', fetcher: async (url) => {
    const u = new URL(String(url)); const engine = u.searchParams.get('engine'); calls.push(`${engine}:${u.searchParams.get('sort') ?? ''}`);
    if (engine === 'walmart') return Response.json({ organic_results: [{ us_item_id: 7, title: 'Apple AirPods Max', reviews: 500 }] });
    const sort = u.searchParams.get('sort');
    return Response.json({ reviews: [{ rating: sort === 'rating-asc' ? 1 : 5, text: `${sort} review` }] });
  } })!;
  const reviews = await serp.productReviews('Apple', 'AirPods Max');
  assert.deepEqual(calls.sort(), ['walmart:', 'walmart_product_reviews:rating-asc', 'walmart_product_reviews:rating-desc']);
  assert.deepEqual(reviews.map((r) => r.rating).sort(), [1, 5]);
});

test('productReviews returns nothing when Walmart has no matching product, and survives one page failing', async () => {
  const none = createSerpApi({ apiKey: 'k', fetcher: async () => Response.json({ organic_results: [{ us_item_id: 1, title: 'Sony thing', reviews: 10 }] }) })!;
  assert.deepEqual(await none.productReviews('Apple', 'AirPods Max'), []);
  const partial = createSerpApi({ apiKey: 'k', fetcher: async (url) => {
    const u = new URL(String(url));
    if (u.searchParams.get('engine') === 'walmart') return Response.json({ organic_results: [{ us_item_id: 7, title: 'Apple AirPods Max', reviews: 500 }] });
    return u.searchParams.get('sort') === 'rating-asc' ? new Response('no', { status: 500 }) : Response.json({ reviews: [{ rating: 5, text: 'fine' }] });
  } })!;
  assert.deepEqual(await partial.productReviews('Apple', 'AirPods Max'), [{ rating: 5, text: 'fine' }]);
});
