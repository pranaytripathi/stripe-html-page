const express = require('express');
const app = express();

const {resolve} = require('path');
// Replace if using a different env file or config
const env = require('dotenv').config({path: './.env'});

const stripeApiVersion = "2020-08-27;invoice_payment_plans_beta=v1"

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: stripeApiVersion,
  appInfo: { // For sample support and debugging, not required for production:
    name: "stripe-samples/accept-a-payment/payment-element",
    version: stripeApiVersion,
    url: "https://github.com/stripe-samples"
  }
});

app.use(express.static(process.env.STATIC_DIR));

app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function (req, res, buf) {
      if (req.originalUrl.startsWith('/webhook')) {
        req.rawBody = buf.toString();
      }
    },
  })
);

app.use(express.json())



app.get('/', (req, res) => {
  const path = resolve(process.env.STATIC_DIR + '/index.html');
  res.sendFile(path);
});

app.get('/config', (req, res) => {
  res.send({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

app.get('/create-payment-intent', async (req, res) => {
  // Create a PaymentIntent with the amount, currency, and a payment method type.
  //
  // See the documentation [0] for the full list of supported parameters.
  //
  // [0] https://stripe.com/docs/api/payment_intents/create
  try {
    console.log(req.query);
    const paymentIntent = await stripe.paymentIntents.create({
      currency: 'EUR',
      amount: 1999,
      ...(req.query.customerId && { customer: req.query.customerId }),
      payment_method_types: ["card"],
      /**
       * Below options will only work in live mode and not in test mode.
       * payment_method_types: ["card", "apple_pay", "google_pay"],
       */
      
      /**
       * Enables card to be used for future usage.
       */
      setup_future_usage: "off_session"
    });

    // Send publishable key and PaymentIntent details to client
    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (e) {
    return res.status(400).send({
      error: {
        message: e.message,
      },
    });
  }
});

app.get("/customers", async (req, res) => {
    const email = req.query.email;
    const list = await stripe.customers.list({
      limit: 100,
    });
    return res.json(list.data[0]);
});


app.post("/create-customer", async (req, res) => {
  const { name, address, email, phone } = req.body;
  const customer = await stripe.customers.create({
    description: `Creating customer ${req.body.name}`,
    name,
    email,
    phone,
    address: {
      line1: address.street,
      state: address.state,
      country: 'US',
      postal_code: address.zip,
    }
  }, {
    apiVersion: stripeApiVersion
  });
  return res.json({ stripeCustomerId: customer.id })
});


app.post("/create-product", async(req, res) => {
  const { name, amount } = req.body;
  const product = await stripe.products.create({
    name,
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount * 100,
    currency: 'usd',
    currency_options: {
      'eur': {
        unit_amount: amount * 100
      }
    }
  }, {
    apiVersion: stripeApiVersion
  });
  return res.json({ id: price.id });
});

app.post("/invoice/quarterly", async(req, res) => {
    const { priceId, currency, customerId } = req.body;
    const price = await stripe.prices.retrieve(priceId, { expand: ["currency_options"]});
    const amount = price.currency_options[currency].unit_amount;
    const invoiceAmount = Math.ceil(amount/3);



    const invoiceCreate = await stripe.invoices.create({
      collection_method: "send_invoice",
      customer: customerId,
      pending_invoice_items_behavior: "exclude",
      auto_advance: true,
      amounts_due: [{
        amount: invoiceAmount,
        description: "Initial Payment",
        days_until_due: 1
      }, {
        amount: invoiceAmount,
        description: "Installment one",
        days_until_due: 30
      }, {
        amount: invoiceAmount,
        description: "Installment two",
        days_until_due: 60
      }]
    }, {
      apiVersion: stripeApiVersion
    });

    
    const invoiceItem = await stripe.invoiceItems.create({
        customer: customerId,
        price: priceId,
        invoice: invoiceCreate.id,
        currency,
    }, {
      apiVersion: stripeApiVersion
    });

    return res.json({ invoiceID: invoiceCreate.id });
});




// Expose a endpoint as a webhook handler for asynchronous events.
// Configure your webhook in the stripe developer dashboard
// https://dashboard.stripe.com/test/webhooks
app.post('/webhook', async (req, res) => {
  let data, eventType;

  // Check if webhook signing is configured.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // we can retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  if (eventType === 'payment_intent.succeeded') {
    // Funds have been captured
    // Fulfill any orders, e-mail receipts, etc
    // To cancel the payment after capture you will need to issue a Refund (https://stripe.com/docs/api/refunds)
    console.log('💰 Payment captured!');
  } else if (eventType === 'payment_intent.payment_failed') {
    console.log('❌ Payment failed.');
  }

  if (eventType === 'invoice_paid') {
    // Funds have been captured
    // Fulfill any orders, e-mail receipts, etc
    // To cancel the payment after capture you will need to issue a Refund (https://stripe.com/docs/api/refunds)
    console.log('💰 Invoice captured!'+ data.object.id); // this id is invoice id
  } else if (eventType === 'invoice.payment_failed') {
    // Sent when a customer attempted a payment on an invoice, but the payment failed.
    
    console.log('❌ invoice failed.' + data.object.id); // this id is invoice id
  } else if (eventType === 'payment_intent.processing') { 
    /*
    Sent when a customer successfully initiated a payment, but the payment has yet to complete. 
    This event is most commonly sent when a bank debit is initiated. 
    It’s followed by either a invoice.paid or invoice.payment_failed event in the future
    */
  }
  res.sendStatus(200);
});


app.listen(4242, () =>
  console.log(`Node server listening at http://localhost:4242`)
);
