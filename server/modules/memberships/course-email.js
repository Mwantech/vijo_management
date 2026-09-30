import { productFor } from './products.js'

const dollars = value => { const n = BigInt(value); return `$${n / 100n}.${String(n % 100n).padStart(2, '0')}` }
export function courseEmail(purchase) {
  const product = productFor(purchase.plan)
  if (!product?.accessUrl) throw new Error('Course access URL is not configured')
  return {
    subject: `Your Nexvijo purchase — ${product.name}`,
    text: `Hi ${purchase.name},

Thank you for purchasing ${product.name} from Nexvijo through Whop.

Product: ${product.name}
Purchase email: ${purchase.email}
Course price: ${dollars(product.amount)} USD
Sales tax: ${dollars(purchase.tax)} USD
Total paid: ${dollars(purchase.total)} USD
Payment reference: ${purchase.providerPaymentId}

Open your course page here:
${product.accessUrl}

Sign in to Whop using the account associated with ${purchase.email}, the email used for this purchase. If the page shows a checkout, open your existing purchase from your Whop account library instead. You have already paid; do not purchase the course again.

Your course access is for your personal use. Please keep this email and your account access private, and never share sign-in codes or course materials. The course page link itself is not a password or a private access token.

If you cannot find your purchase, contact Nexvijo through Whop and include the payment reference above. Never send card details or a sign-in code.

Thank you,
Nexvijo
https://nexvijo.com`,
  }
}
