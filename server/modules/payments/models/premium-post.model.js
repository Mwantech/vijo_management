import { required, enumOf } from './shared.js'
export default ['premium_posts', {
  slug: required(String), title: required(String), excerpt: required(String), content: required(String),
  visibility: enumOf(['public', 'premium']), requiredEntitlement: { type: String, default: 'premium_blog' },
  category: { type: String, default: 'Tutorial' }, published: { type: Boolean, default: false }, publishedAt: Date,
}, [[{ environment: 1, slug: 1 }, { unique: true }], [{ environment: 1, published: 1, publishedAt: -1 }, {}]]]
