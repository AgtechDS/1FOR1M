require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Create Stripe Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { quantity, pricePerLot, userId, lotNumbers } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    const totalAmount = quantity * pricePerLot;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `1FOR1M — ${quantity} Lot${quantity > 1 ? 's' : ''}`,
            description: `Lot numbers: ${lotNumbers.slice(0, 5).join(', ')}${lotNumbers.length > 5 ? '...' : ''}`,
          },
          unit_amount: pricePerLot * 100,
        },
        quantity: quantity,
      }],
      mode: 'payment',
      success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/cancel`,
      metadata: {
        userId,
        lotNumbers: JSON.stringify(lotNumbers),
        quantity: String(quantity),
      },
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stripe Webhook
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    handleCheckoutCompleted(event.data.object);
  }

  res.json({ received: true });
});

async function handleCheckoutCompleted(session) {
  const { metadata } = session;
  if (!metadata || !metadata.userId) return;

  const userId = metadata.userId;
  const lotNumbers = JSON.parse(metadata.lotNumbers || '[]');
  const quantity = parseInt(metadata.quantity || '0');

  try {
    await supabase
      .from('lots')
      .update({
        status: 'sold',
        purchased_by: userId,
        purchased_at: new Date().toISOString()
      })
      .in('lot_number', lotNumbers);

    await supabase
      .from('purchases')
      .insert({
        user_id: userId,
        stripe_payment_intent_id: session.payment_intent,
        stripe_checkout_session_id: session.id,
        quantity,
        amount_eur: session.amount_total / 100,
        currency: session.currency,
        status: 'completed',
        lot_numbers: lotNumbers
      });
  } catch (err) {
    console.error('Webhook handler error:', err);
  }
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`1FOR1M server running on port ${PORT}`));