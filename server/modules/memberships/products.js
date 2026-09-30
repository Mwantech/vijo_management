import { z } from 'zod'

// Public catalog only. Provider IDs must be verified separately before automatic fulfillment.
export const products = [
  { plan: 'premium_blog', name: 'Premium Blog Membership', kind: 'blog', amount: '5000', currency: 'USD' },
  { plan: 'ai_training_premium', name: 'AI Training Course Premium', kind: 'course', amount: '24900', currency: 'USD', accessUrl: 'https://whop.com/nexvijo-com/ai-training-course-premium/' },
  { plan: 'ai_visual_mastery', name: 'AI Visual Content Mastery', kind: 'course', amount: '10000', currency: 'USD', accessUrl: 'https://whop.com/nexvijo-com/ai-visual-content-mastery/' },
]
export const planSchema = z.enum(['premium_blog', 'ai_training_premium', 'ai_visual_mastery'])
export const productFor = plan => products.find(product => product.plan === plan)
// Old posts predate product-specific access and belong to the blog, never a course.
export const contentPlanFilter = plan => plan === 'premium_blog'
  ? { $or: [{ requiredEntitlement: plan }, { requiredEntitlement: { $exists: false } }] }
  : { requiredEntitlement: plan }
