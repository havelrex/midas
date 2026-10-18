import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuery, createSerpApi, ListingsError, parseShipping, pickProduct, toProductDetail, toShoppingItem } from '../src/listings/serpapi.js';

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
