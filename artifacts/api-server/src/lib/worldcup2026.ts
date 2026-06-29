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
  { csvName: "Paraguay", name: "Paraguay", code: "PAR", group: "A", flagEmoji: "🇵🇾" },
  { csvName: "Serbia", name: "Serbia", code: "SRB", group: "A", flagEmoji: "🇷🇸" },
  { csvName: "Japan", name: "Japan", code: "JPN", group: "A", flagEmoji: "🇯🇵" },

  // Group B
  { csvName: "Mexico", name: "Mexico", code: "MEX", group: "B", flagEmoji: "🇲🇽" },
  { csvName: "South Korea", name: "South Korea", code: "KOR", group: "B", flagEmoji: "🇰🇷" },
  { csvName: "Switzerland", name: "Switzerland", code: "SUI", group: "B", flagEmoji: "🇨🇭" },
  { csvName: "South Africa", name: "South Africa", code: "RSA", group: "B", flagEmoji: "🇿🇦" },

  // Group C
  { csvName: "Canada", name: "Canada", code: "CAN", group: "C", flagEmoji: "🇨🇦" },
  { csvName: "Qatar", name: "Qatar", code: "QAT", group: "C", flagEmoji: "🇶🇦" },
  { csvName: "Denmark", name: "Denmark", code: "DEN", group: "C", flagEmoji: "🇩🇰" },
  { csvName: "Nigeria", name: "Nigeria", code: "NGA", group: "C", flagEmoji: "🇳🇬" },

  // Group D
  { csvName: "Brazil", name: "Brazil", code: "BRA", group: "D", flagEmoji: "🇧🇷" },
  { csvName: "Morocco", name: "Morocco", code: "MAR", group: "D", flagEmoji: "🇲🇦" },
  { csvName: "Ukraine", name: "Ukraine", code: "UKR", group: "D", flagEmoji: "🇺🇦" },
  { csvName: "Australia", name: "Australia", code: "AUS", group: "D", flagEmoji: "🇦🇺" },

  // Group E
  { csvName: "Argentina", name: "Argentina", code: "ARG", group: "E", flagEmoji: "🇦🇷" },
  { csvName: "Austria", name: "Austria", code: "AUT", group: "E", flagEmoji: "🇦🇹" },
  { csvName: "Algeria", name: "Algeria", code: "ALG", group: "E", flagEmoji: "🇩🇿" },
  { csvName: "Uzbekistan", name: "Uzbekistan", code: "UZB", group: "E", flagEmoji: "🇺🇿" },

  // Group F
  { csvName: "France", name: "France", code: "FRA", group: "F", flagEmoji: "🇫🇷" },
  { csvName: "Ecuador", name: "Ecuador", code: "ECU", group: "F", flagEmoji: "🇪🇨" },
  { csvName: "Saudi Arabia", name: "Saudi Arabia", code: "KSA", group: "F", flagEmoji: "🇸🇦" },
  { csvName: "Norway", name: "Norway", code: "NOR", group: "F", flagEmoji: "🇳🇴" },

  // Group G
  { csvName: "England", name: "England", code: "ENG", group: "G", flagEmoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { csvName: "Uruguay", name: "Uruguay", code: "URU", group: "G", flagEmoji: "🇺🇾" },
  { csvName: "Ivory Coast", name: "Ivory Coast", code: "CIV", group: "G", flagEmoji: "🇨🇮" },
  { csvName: "Iraq", name: "Iraq", code: "IRQ", group: "G", flagEmoji: "🇮🇶" },

  // Group H
  { csvName: "Germany", name: "Germany", code: "GER", group: "H", flagEmoji: "🇩🇪" },
  { csvName: "Colombia", name: "Colombia", code: "COL", group: "H", flagEmoji: "🇨🇴" },
  { csvName: "Iran", name: "Iran", code: "IRN", group: "H", flagEmoji: "🇮🇷" },
  { csvName: "New Zealand", name: "New Zealand", code: "NZL", group: "H", flagEmoji: "🇳🇿" },

  // Group I
  { csvName: "Spain", name: "Spain", code: "ESP", group: "I", flagEmoji: "🇪🇸" },
  { csvName: "Egypt", name: "Egypt", code: "EGY", group: "I", flagEmoji: "🇪🇬" },
  { csvName: "Costa Rica", name: "Costa Rica", code: "CRC", group: "I", flagEmoji: "🇨🇷" },
  { csvName: "Turkey", name: "Turkey", code: "TUR", group: "I", flagEmoji: "🇹🇷" },

  // Group J
  { csvName: "Portugal", name: "Portugal", code: "POR", group: "J", flagEmoji: "🇵🇹" },
  { csvName: "Senegal", name: "Senegal", code: "SEN", group: "J", flagEmoji: "🇸🇳" },
  { csvName: "Chile", name: "Chile", code: "CHI", group: "J", flagEmoji: "🇨🇱" },
  { csvName: "Jamaica", name: "Jamaica", code: "JAM", group: "J", flagEmoji: "🇯🇲" },

  // Group K
  { csvName: "Belgium", name: "Belgium", code: "BEL", group: "K", flagEmoji: "🇧🇪" },
  { csvName: "Croatia", name: "Croatia", code: "CRO", group: "K", flagEmoji: "🇭🇷" },
  { csvName: "Venezuela", name: "Venezuela", code: "VEN", group: "K", flagEmoji: "🇻🇪" },
  { csvName: "Tunisia", name: "Tunisia", code: "TUN", group: "K", flagEmoji: "🇹🇳" },

  // Group L
  { csvName: "Netherlands", name: "Netherlands", code: "NED", group: "L", flagEmoji: "🇳🇱" },
  { csvName: "Italy", name: "Italy", code: "ITA", group: "L", flagEmoji: "🇮🇹" },
  { csvName: "Panama", name: "Panama", code: "PAN", group: "L", flagEmoji: "🇵🇦" },
  { csvName: "Cameroon", name: "Cameroon", code: "CMR", group: "L", flagEmoji: "🇨🇲" },
];

export const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

export function getTeamByCsvName(csvName: string): WCTeam | undefined {
  return WC2026_TEAMS.find((t) => t.csvName === csvName);
}

export function getTeamByName(name: string): WCTeam | undefined {
  return WC2026_TEAMS.find((t) => t.name === name);
}
