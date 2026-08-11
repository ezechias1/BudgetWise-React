// SA official languages — ISO 639-1/3 codes where available. Junior surface only.
export type LangCode =
  | 'en'   // English
  | 'af'   // Afrikaans
  | 'zu'   // isiZulu
  | 'xh'   // isiXhosa
  | 'st'   // Sesotho
  | 'nso'  // Sepedi / Northern Sotho
  | 'tn'   // Setswana
  | 've'   // Tshivenda
  | 'ts'   // Xitsonga
  | 'nr'   // isiNdebele
  | 'ss';  // siSwati

export interface JuniorStrings {
  // Login — no device kids yet
  login_no_link_title: string;
  login_no_link_intro: string;
  login_no_link_ask_parent: string;
  login_no_link_step1: string;
  login_no_link_step2: string;
  login_no_link_step3: string;
  login_no_link_footer: string;

  // Login — pick a kid
  login_pick_title: string;
  login_pick_subtitle: string;

  // Login — PIN entry
  login_pin_title: string;
  login_pin_subtitle: string;
  login_pin_back: string;
  login_pin_rate_limited: string;
  login_pin_hint_stale: string;
  login_pin_wrong: string;
  login_pin_checking: string;
  login_pin_go: string;
  login_pin_footer: string;
  login_pin_aria: string;

  // Layout / bottom nav
  nav_home: string;
  nav_chores: string;
  nav_jars: string;
  nav_missions: string;
  nav_goals: string;
  nav_back_parent: string;
  nav_sign_out: string;

  // Language selector
  language_label: string;
  language_coming_soon: string;
}
