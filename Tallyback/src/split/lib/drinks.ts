// Is this receipt line alcohol? A starting guess the person can correct on each line. Pure.
// Whole words only, so "ginger" isn't gin and "brumby" isn't rum. Soft drinks win over a match
// ("ginger beer", "root beer"), and regional names matter: receipts here say Tiger, Singha, soju.

// Food cooked with it isn't a drink: "beer battered fish", "beef in red wine".
const SOFT = /\b(ginger beer|root beer|non[- ]?alcoholic|alcohol[- ]?free|zero alcohol|mocktails?|virgin|battered|sauce|braised|glazed|cake|chicken|beef|pork|fish|prawns?|mussels|clams)\b/i;
const DRINK =
  /\b(beers?|lagers?|ales?|ipa|stouts?|pints?|draught|draft|pitchers?|wines?|merlot|shiraz|cabernet|pinot|chardonnay|sauvignon|riesling|rose|prosecco|champagne|cava|sake|soju|shochu|makgeolli|highballs?|whiske?y|bourbon|scotch|vodka|gin|rum|tequila|brandy|cognac|baijiu|mezcal|cocktails?|martini|mojito|negroni|margarita|sangria|spritz|shots?|tiger|heineken|carlsberg|guinness|corona|asahi|kirin|sapporo|singha|chang|bintang|san miguel|red horse|erdinger|hoegaarden|stella|budweiser)\b/i;

export const isDrink = (description: string) => !SOFT.test(description) && DRINK.test(description.replace(/é/gi, "e"));
