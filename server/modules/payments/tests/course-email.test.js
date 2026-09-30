import { it, expect } from 'vitest'
import { courseEmail } from '../../memberships/course-email.js'
import { postSchema } from '../../memberships/domain.js'

it('uses the purchased product link and exact tax-inclusive total without promising undeployed access', () => {
  const message = courseEmail({ name: 'Learner', email: 'learner@example.com', plan: 'ai_training_premium', tax: '1992', total: '26892', providerPaymentId: 'pay_test' })
  expect(message.text).toContain('https://whop.com/nexvijo-com/ai-training-course-premium/')
  expect(message.text).toContain('$249.00 USD')
  expect(message.text).toContain('$268.92 USD')
  expect(message.text).not.toContain('/blog/membership')
  expect(message.text).not.toContain('AI Visual Content Mastery')
  expect(message.text).toContain('do not purchase the course again')
})
it('does not allow arbitrary entitlement names in content', () => {
  const post = { slug: 'test', title: 'Course', excerpt: 'A test course preview', content: 'A course body of sufficient length.', visibility: 'premium', published: true, category: 'Lesson' }
  expect(postSchema.parse(post).requiredEntitlement).toBe('premium_blog')
  expect(postSchema.safeParse({ ...post, requiredEntitlement: { $ne: null } }).success).toBe(false)
})
