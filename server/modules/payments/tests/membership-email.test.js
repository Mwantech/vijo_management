import { it, expect } from 'vitest'
import { verificationEmail } from '../../memberships/email-service.js'
it('requests verification and promises manual fulfillment, with support and refund-request wording', () => {
  const email = verificationEmail({ plan: 'ai_visual_mastery', email: 'learner@example.com' }, 'https://nexvijo.com')
  expect(email.replyTo).toBe('company@nexvijo.com')
  expect(email.text).toContain('https://nexvijo.com/blog/membership')
  expect(email.text).toContain('manually send you the Google Drive link')
  expect(email.text).toContain('request a refund')
  expect(email.text).not.toContain('drive.google.com')
  expect(email.text).not.toContain('AI Training Course Premium')
  expect(() => verificationEmail({ plan: 'premium_blog' }, 'https://nexvijo.com')).toThrow()
})
