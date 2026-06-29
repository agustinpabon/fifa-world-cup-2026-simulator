export interface WCTeam {
  csvName: string;
  name: string;
  code: string;
  group: string;
  flagEmoji: string;
}

export const WC2026_TEAMS: WCTeam[] = [
  // Group A
  { csvName: "United States", name: "USA", code: "USA", group: "A", flagEmoji: "🇺🇸" },
  { csvName: "Panama", name: "Panama", code: "PAN", group: "A", flagEmoji: "🇵🇦" },
  { csvName: "Uruguay", name: "Uruguay", code: "URU", group: "A", flagEmoji: "🇺🇾" },
  { csvName: "Bolivia", name: "Bolivia", code: "BOL", group: "A", flagEmoji: "🇧🇴" },

  // Group B
  { csvName: "Mexico", name: "Mexico", code: "MEX", group: "B", flagEmoji: "🇲🇽" },
  { csvName: "Jamaica", name: "Jamaica", code: "JAM", group: "B", flagEmoji: "🇯🇲" },
  { csvName: "Venezuela", name: "Venezuela", code: "VEN", group: "B", flagEmoji: "🇻🇪" },
  { csvName: "Ecuador", name: "Ecuador", code: "ECU", group: "B", flagEmoji: "🇪🇨" },

  // Group C
  { csvName: "Canada", name: "Canada", code: "CAN", group: "C", flagEmoji: "🇨🇦" },
  { csvName: "Honduras", name: "Honduras", code: "HON", group: "C", flagEmoji: "🇭🇳" },
  { csvName: "New Zealand", name: "New Zealand", code: "NZL", group: "C", flagEmoji: "🇳🇿" },
  { csvName: "Malaysia", name: "Malaysia", code: "MAS", group: "C", flagEmoji: "🇲🇾" },

  // Group D
  { csvName: "Brazil", name: "Brazil", code: "BRA", group: "D", flagEmoji: "🇧🇷" },
  { csvName: "Colombia", name: "Colombia", code: "COL", group: "D", flagEmoji: "🇨🇴" },
  { csvName: "Japan", name: "Japan", code: "JPN", group: "D", flagEmoji: "🇯🇵" },
  { csvName: "Morocco", name: "Morocco", code: "MAR", group: "D", flagEmoji: "🇲🇦" },

  // Group E
  { csvName: "Argentina", name: "Argentina", code: "ARG", group: "E", flagEmoji: "🇦🇷" },
  { csvName: "Chile", name: "Chile", code: "CHI", group: "E", flagEmoji: "🇨🇱" },
  { csvName: "Peru", name: "Peru", code: "PER", group: "E", flagEmoji: "🇵🇪" },
  { csvName: "Cameroon", name: "Cameroon", code: "CMR", group: "E", flagEmoji: "🇨🇲" },

  // Group F
  { csvName: "France", name: "France", code: "FRA", group: "F", flagEmoji: "🇫🇷" },
  { csvName: "Algeria", name: "Algeria", code: "ALG", group: "F", flagEmoji: "🇩🇿" },
  { csvName: "Saudi Arabia", name: "Saudi Arabia", code: "KSA", group: "F", flagEmoji: "🇸🇦" },
  { csvName: "Indonesia", name: "Indonesia", code: "IDN", group: "F", flagEmoji: "🇮🇩" },

  // Group G
  { csvName: "England", name: "England", code: "ENG", group: "G", flagEmoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { csvName: "Serbia", name: "Serbia", code: "SRB", group: "G", flagEmoji: "🇷🇸" },
  { csvName: "Senegal", name: "Senegal", code: "SEN", group: "G", flagEmoji: "🇸🇳" },
  { csvName: "Tunisia", name: "Tunisia", code: "TUN", group: "G", flagEmoji: "🇹🇳" },

  // Group H
  { csvName: "Germany", name: "Germany", code: "GER", group: "H", flagEmoji: "🇩🇪" },
  { csvName: "Poland", name: "Poland", code: "POL", group: "H", flagEmoji: "🇵🇱" },
  { csvName: "Costa Rica", name: "Costa Rica", code: "CRC", group: "H", flagEmoji: "🇨🇷" },
  { csvName: "Ghana", name: "Ghana", code: "GHA", group: "H", flagEmoji: "🇬🇭" },

  // Group I
  { csvName: "Spain", name: "Spain", code: "ESP", group: "I", flagEmoji: "🇪🇸" },
  { csvName: "Egypt", name: "Egypt", code: "EGY", group: "I", flagEmoji: "🇪🇬" },
  { csvName: "Nigeria", name: "Nigeria", code: "NGA", group: "I", flagEmoji: "🇳🇬" },
  { csvName: "El Salvador", name: "El Salvador", code: "SLV", group: "I", flagEmoji: "🇸🇻" },

  // Group J
  { csvName: "Portugal", name: "Portugal", code: "POR", group: "J", flagEmoji: "🇵🇹" },
  { csvName: "Netherlands", name: "Netherlands", code: "NED", group: "J", flagEmoji: "🇳🇱" },
  { csvName: "South Korea", name: "South Korea", code: "KOR", group: "J", flagEmoji: "🇰🇷" },
  { csvName: "Iran", name: "Iran", code: "IRN", group: "J", flagEmoji: "🇮🇷" },

  // Group K
  { csvName: "Belgium", name: "Belgium", code: "BEL", group: "K", flagEmoji: "🇧🇪" },
  { csvName: "Croatia", name: "Croatia", code: "CRO", group: "K", flagEmoji: "🇭🇷" },
  { csvName: "Australia", name: "Australia", code: "AUS", group: "K", flagEmoji: "🇦🇺" },
  { csvName: "Qatar", name: "Qatar", code: "QAT", group: "K", flagEmoji: "🇶🇦" },

  // Group L
  { csvName: "Italy", name: "Italy", code: "ITA", group: "L", flagEmoji: "🇮🇹" },
  { csvName: "Turkey", name: "Turkey", code: "TUR", group: "L", flagEmoji: "🇹🇷" },
  { csvName: "Austria", name: "Austria", code: "AUT", group: "L", flagEmoji: "🇦🇹" },
  { csvName: "Iraq", name: "Iraq", code: "IRQ", group: "L", flagEmoji: "🇮🇶" },
];

export const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

export function getTeamByCsvName(csvName: string): WCTeam | undefined {
  return WC2026_TEAMS.find((t) => t.csvName === csvName);
}

export function getTeamByName(name: string): WCTeam | undefined {
  return WC2026_TEAMS.find((t) => t.name === name);
}
