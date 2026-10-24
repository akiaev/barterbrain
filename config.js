// ==========================================================
// CONFIG: your links, keys and lists. Fill this in once.
// Updates to script.js will never overwrite this file.
// ==========================================================
// Published CSV link of your MEMBERS tab. Leave "" to use demo data.
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR1JehNR8IG2jSh4tVKGqzBV-TV4stsX8uwdnVWSL65vCTeupsD6kNHEBikvtwvmNLUltvUCh64mYcg/pub?gid=1321890737&single=true&output=csv";

// Your sign-up Form's link, but ending in /formResponse (not /viewform).
const FORM_POST_URL = "https://docs.google.com/forms/d/e/1FAIpQLSeuxl2JvQXMizn-JPC1lPoJkswqqLB1nC7_KuEtR8fqja8EQw/formResponse";

// ----- Swap requests (your NEW "Swap requests" Form) -----
// The Form's link, ending in /formResponse (not /viewform).
const REQUEST_POST_URL = "https://docs.google.com/forms/d/e/1FAIpQLScPzUYa7nPDr9PjQBG674TWAEZhWZ1KzqIq7aNKr6qZslPC5A/formResponse";
// The entry.NUMBER of each question in that Form.
const REQUEST_ENTRY = {
  to: "entry.1144570671", from: "entry.570367462", fromName: "entry.2008983719",
  skills: "entry.2109130200", message: "entry.1590806063", contact: "entry.972173006"
};
// Published CSV link of the Requests tab. Leave "" until it's ready.
const REQUESTS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR1JehNR8IG2jSh4tVKGqzBV-TV4stsX8uwdnVWSL65vCTeupsD6kNHEBikvtwvmNLUltvUCh64mYcg/pub?gid=1912201153&single=true&output=csv";

// The entry.NUMBER of each Form question (from the "Get pre-filled link" trick).
const ENTRY = {
  name: "entry.1761019904", section: "entry.1982905223", teach: "entry.486808123",
  learn: "entry.304650221", days: "entry.2134167748", mode: "entry.1992010531",
  contact: "entry.103820474", email: "entry.1258780838",
  username: "entry.605530199", pinHash: "entry.1891247441"
};

// ----- Skill requests (students ask for a new skill, YOU approve it) -----
// Your "Skill requests" Form's link, ending in /formResponse (not /viewform). Leave "" until it's ready.
const SKILL_REQUEST_POST_URL = "https://docs.google.com/forms/d/e/1FAIpQLScw-GCA9Y4kBlVGGR6p44OmT8ZXGh7r8_L4Mx_ZlPVxaCTXAw/formResponse";
// The entry.NUMBER of the 2 questions in that Form: the skill, and who asked for it.
const SKILL_REQUEST_ENTRY = { skill: "entry.1982034844", by: "entry.861754778" };
// Published CSV link of your "Approved skills" tab (skills in column A, header in row 1).
// Anything you type into that tab appears for everyone. Leave "" to only use the SKILLS list below.
const APPROVED_SKILLS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR1JehNR8IG2jSh4tVKGqzBV-TV4stsX8uwdnVWSL65vCTeupsD6kNHEBikvtwvmNLUltvUCh64mYcg/pub?gid=1409822221&single=true&output=csv";

const SCHOOL_DOMAIN = "@lpulaguna.edu.ph";
const SALT = "markbeaace";   // any random text. Pick one and never change it after people sign up.


const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SKILLS = ["python", "c++", "html/css", "javascript", "excel", "ms word", "photoshop", "canva", "ui/ux", "video editing",
  "guitar", "piano", "drawing", "math tutoring", "public speaking", "essay writing", "filipino", "japanese", "cooking"];

// ----- Swap request cooldown -----
// How long someone must wait before sending the SAME person another request, in minutes.
// 60 = 1 hour. Decimals work (0.5 = 30 seconds). 0 = no cooldown. Handy values: 0.5 to test, 60 normal, 1440 = 1 day.
const REQUEST_COOLDOWN_MINUTES = 60;