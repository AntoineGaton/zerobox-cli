export type Verdict = "Nuke" | "Review" | "Keep" | "Protect";
export type UnsubKind = "one-click" | "email" | "web" | "none";

export type Sender = {
  id: string;
  name: string;
  addr: string;
  count: number;
  read: number;
  verdict: Verdict;
  unsub: UnsubKind;
  subjects: string[];
};

/** Sample data for the landing-page demo. Not real mail. */
export const DATA: Sender[] = [
  { id: "a", name: "Weekly Deals", addr: "deals@shop.example", count: 1204, read: 2, verdict: "Nuke", unsub: "one-click", subjects: ["48 hours only: 60% off", "Your cart misses you", "New arrivals picked for you"] },
  { id: "b", name: "Social Updates", addr: "notify@social.example", count: 812, read: 4, verdict: "Nuke", unsub: "one-click", subjects: ["You have 9 new notifications", "Someone viewed your profile", "See what you missed this week"] },
  { id: "c", name: "Product News", addr: "news@saas.example", count: 433, read: 9, verdict: "Review", unsub: "one-click", subjects: ["What shipped in September", "Webinar: scaling your team", "Your monthly usage report"] },
  { id: "d", name: "Travel Offers", addr: "offers@travel.example", count: 297, read: 0, verdict: "Nuke", unsub: "email", subjects: ["Fares to Lisbon just dropped", "Weekend escapes under $200", "Your trip ideas are waiting"] },
  { id: "e", name: "Dev Digest", addr: "digest@dev.example", count: 188, read: 61, verdict: "Keep", unsub: "one-click", subjects: ["This week in TypeScript", "Release notes: v5.6", "Top posts you might like"] },
  { id: "f", name: "Bank Alerts", addr: "alerts@bank.example", count: 96, read: 94, verdict: "Protect", unsub: "none", subjects: ["Your statement is ready", "Payment received", "New sign-in to your account"] },
  { id: "g", name: "Recipes Weekly", addr: "hello@recipes.example", count: 74, read: 12, verdict: "Review", unsub: "web", subjects: ["5 soups for cold nights", "Sheet-pan dinners", "Your saved recipes"] },
];

export const VCOLOR: Record<Verdict, string> = { Nuke: "#FF8A7A", Review: "#F5C451", Keep: "#6FDC9C", Protect: "#7AB8FF" };

export const UNSUB: Record<UnsubKind, string> = {
  "one-click": "one-click, automatic",
  email: "by email, automatic",
  web: "opens their page",
  none: "none (account mail)",
};

export const fmt = (n: number) => n.toLocaleString("en-US");
