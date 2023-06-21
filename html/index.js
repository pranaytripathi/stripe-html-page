document.addEventListener('DOMContentLoaded', async () => {
  // Load the publishable key from the server. The publishable key
  // is set in your .env file.
  const { publishableKey } = await fetch('/config').then((r) => r.json());
  if (!publishableKey) {
    addMessage(
      'No publishable key returned from the server. Please check `.env` and try again'
    );
    alert('Please set your Stripe publishable API key in the .env file');
  }

  const stripe = Stripe(publishableKey, {
    apiVersion: '2020-08-27',
  });

  // On page load, we create a PaymentIntent on the server so that we have its clientSecret to
  // initialize the instance of Elements below. The PaymentIntent settings configure which payment
  // method types to display in the PaymentElement.
  const createPayment = async (customerId) => {
    const {
      error: backendError,
      clientSecret
    } = await fetch(`/create-payment-intent?customerId=${customerId}`).then(r => r.json());
    if (backendError) {
      addMessage(backendError.message);
    }
    addMessage(`Client secret returned.`);
    return clientSecret;
  }

  // If the customer's email is known when the page is loaded, you can
  // pass the email to the linkAuthenticationElement on mount:
  //
  //   linkAuthenticationElement.mount("#link-authentication-element",  {
  //     defaultValues: {
  //       email: 'jenny.rosen@example.com',
  //     }
  //   })
  // If you need access to the email address entered:
  //
  //  linkAuthenticationElement.on('change', (event) => {
  //    const email = event.value.email;
  //    console.log({ email });
  //  })

  // When the form is submitted...
  const form = document.getElementById('payment-form');
  let submitted = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Disable double submission of the form
    if (submitted) { return; }
    submitted = true;
    form.querySelector('button').disabled = true;

    const nameInput = document.querySelector('#name');

    // Confirm the payment given the clientSecret
    // from the payment intent that was just created on
    // the server.
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/return.html`,
      }
    });

    if (stripeError) {
      addMessage(stripeError.message);

      // reenable the form.
      submitted = false;
      form.querySelector('button').disabled = false;
      return;
    }
  });
  const customerForm = document.getElementById('customer-info-form');
  customerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: `${document.getElementById('customer-name').value} ${document.getElementById('last-name').value}`,
      email: document.getElementById('customer-email').value,
      phoneNumber: document.getElementById('phone').value,
      address: {
        street: document.getElementById('street').value,
        zip: document.getElementById('zip').value,
        state: document.getElementById('state').value,
        country: document.getElementById('country').value
      }
    }

    const { stripeCustomerId } = await fetch("/create-customer", { 
      method: "POST",
      headers: { 'Content-type': 'application/json' }, 
      body: JSON.stringify(body) }).then((r) => r.json());

    if (!stripeCustomerId) {
      console.error('No customer Id')
      return;
    }
    console.log(stripeCustomerId);
    const clientSecret = await createPayment(stripeCustomerId);
    const elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create('payment');
    paymentElement.mount('#payment-element');
    // Create and mount the linkAuthentication Element to enable autofilling customer payment details
    const linkAuthenticationElement = elements.create("linkAuthentication");
    linkAuthenticationElement.mount("#link-authentication-element");

    customerForm.style.visibility = 'hidden';
    customerForm.style.height = '0px';
  });
});
