import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, Nanum_Pen_Script, Source_Serif_4, Spline_Sans_Mono } from "next/font/google";
import "./welcome.css";

// TallyBack's public page: no sign-in. It sits outside app/(apps), so the sign-in wall doesn't apply.
// Every line here is something the app does today; keep it that way when features change.

// The same pair as the Tinkeryard landing page, plus the till and the pen for the receipt.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--tb-display", axes: ["wdth", "opsz"] });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--tb-serif" });
const till = Spline_Sans_Mono({ subsets: ["latin"], variable: "--tb-till" });
const pen = Nanum_Pen_Script({ subsets: ["latin"], weight: "400", variable: "--tb-pen" });

export const metadata: Metadata = {
  title: "TallyBack: check the bill, then split it fairly",
  description: "Photograph a bill and TallyBack checks every line and the tax. Then split the right total with friends, in any Asia-Pacific currency.",
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#d9ddd4" },
    { media: "(prefers-color-scheme: dark)", color: "#111916" },
  ],
};

const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: "Checking the bill",
    items: [
      ["Scan any bill", "Take a photo or upload a PDF. Every line is read in seconds."],
      ["Every sum rechecked", "Quantity times price, lines against subtotal, tax, and the final total."],
      ["Tax rate against the law", "Rates on file for Singapore, the UK, Australia, New Zealand, the UAE and India."],
      ["Numbers from code, not AI", "AI reads the bill. Plain arithmetic decides whether it's wrong."],
      ["The message, already written", "A polite note to the shop with the exact amounts filled in."],
    ],
  },
  {
    title: "Splitting with friends",
    items: [
      ["Split the right total", "Leave the overcharge out, so nobody pays for the shop's mistake."],
      ["Claim dishes from the receipt", "Tax and service charge follow what each person ate."],
      ["Drinks separately", "Pick who isn't drinking and they come off every drink at once."],
      ["Equal, exact, percent or shares", "Whichever suits rent, groceries or dinner."],
      ["Repeating expenses", "Rent and subscriptions add themselves each week, month or year."],
    ],
  },
  {
    title: "Nights out and trips",
    items: [
      ["Whose round is it", "Everyone at the table sees whose turn it is, with a WhatsApp reminder."],
      ["Trip mode", "Set the place and dates. New expenses start in the local currency."],
      ["17 currencies", "Pesos, baht, yen, rupiah and more, converted at the day's rate or your card's."],
      ["The trip wrap-up", "Total spent, who covered the most, and who pays whom."],
    ],
  },
  {
    title: "Settling up",
    items: [
      ["Whose turn to pay", "Whoever owes the most gets the next one, so balances even out by themselves."],
      ["Settle in two taps", "Pick the person and the amount is filled in. Paying part of it works too."],
      ["One friend, every group", "Clear everything between the two of you at once."],
      ["Fewest payments", "Debts across the group are simplified, then shared to WhatsApp."],
    ],
  },
  {
    title: "Trust between friends",
    items: [
      ["Every edit spelled out", "“Sam changed Dinner from S$40 to S$60” appears for the whole group."],
      ["Private receipts", "Only the group's current members can open a receipt photo."],
      ["No passwords", "Sign in with your face, fingerprint or an emailed code."],
      ["Nothing lost", "Deleted expenses and groups can be brought back."],
    ],
  },
];
const COUNT = SECTIONS.reduce((n, s) => n + s.items.length, 0);

const Tick = () => (
  <svg className="tb-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 13.5c1.6 1.2 3.2 3.2 4.6 5.8C11 12.6 15 7.6 20.5 4" />
  </svg>
);

const Row = ({ name, amount }: { name: string; amount: string }) => (
  <div className="tb-row">
    <span>{name}</span>
    <span>{amount}</span>
  </div>
);

export default function Welcome() {
  return (
    <main className={`tb ${display.variable} ${serif.variable} ${till.variable} ${pen.variable}`}>
      <div className="tb-frame">
        <div className="tb-pitch">
          <p className="tb-brand">TallyBack</p>
          <h1 className="tb-headline">Check the bill. Then split it fairly.</h1>
          <p className="tb-lede">Restaurants, shops and utilities get bills wrong. TallyBack finds the line that doesn&apos;t add up, and your friends only pay for what&apos;s right.</p>
          <Link href="/tallyback" className="tb-cta">
            Open TallyBack
          </Link>
          <p className="tb-invite">TallyBack is invite-only for now. Ask a friend who uses it to send you an invite.</p>
        </div>

        <article className="tb-receipt" aria-label="An example bill, followed by everything TallyBack does">
          <div aria-label="Example: a restaurant bill charging 10% GST instead of 9%">
            <div className="tb-shop">
              <b>The Corner Table</b>
              <br />
              Singapore
            </div>
            <div className="tb-rows">
              <Row name="2 x Laksa" amount="28.00" />
              <Row name="1 x Satay set" amount="18.00" />
              <Row name="3 x Tiger pint" amount="40.00" />
            </div>
            <div className="tb-sums">
              <Row name="Subtotal" amount="86.00" />
              <Row name="Service charge 10%" amount="8.60" />
              <div className="tb-row tb-mark">
                <span>GST 10%</span>
                <span>9.46</span>
              </div>
              <p className="tb-pen tb-note">GST is 9%. That&apos;s S$0.95 too much</p>
            </div>
            <div className="tb-sums tb-row tb-grand">
              <span>Total</span>
              <span className="tb-struck">104.06</span>
            </div>
            <p className="tb-pen tb-right">should be 103.11</p>
          </div>

          {SECTIONS.map((s) => (
            <section key={s.title} className="tb-section">
              <h2>{s.title}</h2>
              <ul className="tb-items">
                {s.items.map(([name, about]) => (
                  <li key={name} className="tb-item">
                    <b>{name}</b>
                    <Tick />
                    <p>{about}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="tb-foot">
            <div className="tb-row tb-grand">
              <span>Total</span>
              <span>{COUNT} features</span>
            </div>
            <p style={{ marginTop: 12 }}>Thank you. Please check your bill.</p>
            <Link href="/tallyback" className="tb-foot-cta">
              Open TallyBack
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
