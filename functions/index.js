const { onCall, onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

// Durées d'accès en jours selon le Price ID
const DUREES_PAR_PRIX = {
  "price_1TxtEJIAgyQD2PevhFzo26Nx": 30,
  "price_1TxnuSIAgyQD2Pev3g7laCsy": 90,
  "price_1TxoKlIAgyQD2PevfAbHkMBS": 365,
};

// 1. Crée une session de paiement Stripe
exports.createCheckoutSession = onCall(
  { secrets: ["STRIPE_SECRET_KEY"] },
  async (request) => {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const data = request.data;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: data.priceId, quantity: 1 }],
      customer_email: data.email,
      success_url: "https://civicum.fr/success",
      cancel_url: "https://civicum.fr/cancel",
    });
    return { url: session.url };
  }
);

// 2. Reçoit la confirmation de paiement et active le compte pour la durée correspondante
exports.stripeWebhook = onRequest(
  { secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] },
  async (req, res) => {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const email = session.customer_email;
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0].price.id;
        const jours = DUREES_PAR_PRIX[priceId] || 30;
        const dateExpiration = Date.now() + jours * 24 * 60 * 60 * 1000;

        const user = await admin.auth().getUserByEmail(email);
        await admin.firestore().collection("users").doc(user.uid).update({
          actif: true,
          expireLe: dateExpiration,
        });
      } catch (err) {
        console.error("Erreur activation utilisateur:", err);
      }
    }
    res.status(200).send("ok");
  }
);