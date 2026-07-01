import { GROUP_IDS, type GroupId, type TournamentTeam } from "./tournament-data.js";

export { GROUP_IDS, type GroupId };

export type KnockoutStage = "R32" | "R16" | "QF" | "SF" | "F";
export type ThirdPlaceAssignmentSlotGroup = "A" | "B" | "D" | "E" | "G" | "I" | "K" | "L";
export type ThirdPlaceAssignment = Record<ThirdPlaceAssignmentSlotGroup, GroupId>;

type ThirdPlaceCombinationKey = string;
type ThirdPlaceAssignmentCode = string;
type ThirdPlaceAssignmentRow = readonly [ThirdPlaceCombinationKey, ThirdPlaceAssignmentCode];

interface WinnerSeed {
  type: "winner";
  group: GroupId;
}

interface RunnerUpSeed {
  type: "runnerUp";
  group: GroupId;
}

interface ThirdPlaceSeed {
  type: "thirdPlace";
  slotWinnerGroup: ThirdPlaceAssignmentSlotGroup;
}

interface PreviousWinnerSeed {
  type: "previousWinner";
  sourceMatchNumber: number;
}

type RoundOf32Seed = WinnerSeed | RunnerUpSeed | ThirdPlaceSeed;
type ResolvedKnockoutSeed = WinnerSeed | RunnerUpSeed | ThirdPlaceSeed | PreviousWinnerSeed;

interface RoundOf32MatchTemplate {
  matchNumber: number;
  stage: "R32";
  home: RoundOf32Seed;
  away: RoundOf32Seed;
}

export interface PreviousWinnerMatchTemplate {
  matchNumber: number;
  stage: Exclude<KnockoutStage, "R32">;
  homeSourceMatchNumber: number;
  awaySourceMatchNumber: number;
}

interface KnockoutMatchMetadata {
  date: string;
  venue: string;
}

export interface KnockoutMatch {
  matchNumber: number;
  stage: KnockoutStage;
  home: TournamentTeam;
  away: TournamentTeam;
  homeSeed: ResolvedKnockoutSeed;
  awaySeed: ResolvedKnockoutSeed;
  date: string;
  venue: string;
}

export const THIRD_PLACE_ASSIGNMENT_SLOT_GROUPS = ["A", "B", "D", "E", "G", "I", "K", "L"] as const;

export const THIRD_PLACE_ASSIGNMENT_ROWS = [
  ["EFGHIJKL", "EJIFHGLK"],
  ["DFGHIJKL", "HGIDJFLK"],
  ["DEGHIJKL", "EJIDHGLK"],
  ["DEFHIJKL", "EJIDHFLK"],
  ["DEFGIJKL", "EGIDJFLK"],
  ["DEFGHJKL", "EGJDHFLK"],
  ["DEFGHIKL", "EGIDHFLK"],
  ["DEFGHIJL", "EGJDHFLI"],
  ["DEFGHIJK", "EGJDHFIK"],
  ["CFGHIJKL", "HGICJFLK"],
  ["CEGHIJKL", "EJICHGLK"],
  ["CEFHIJKL", "EJICHFLK"],
  ["CEFGIJKL", "EGICJFLK"],
  ["CEFGHJKL", "EGJCHFLK"],
  ["CEFGHIKL", "EGICHFLK"],
  ["CEFGHIJL", "EGJCHFLI"],
  ["CEFGHIJK", "EGJCHFIK"],
  ["CDGHIJKL", "HGICJDLK"],
  ["CDFHIJKL", "CJIDHFLK"],
  ["CDFGIJKL", "CGIDJFLK"],
  ["CDFGHJKL", "CGJDHFLK"],
  ["CDFGHIKL", "CGIDHFLK"],
  ["CDFGHIJL", "CGJDHFLI"],
  ["CDFGHIJK", "CGJDHFIK"],
  ["CDEHIJKL", "EJICHDLK"],
  ["CDEGIJKL", "EGICJDLK"],
  ["CDEGHJKL", "EGJCHDLK"],
  ["CDEGHIKL", "EGICHDLK"],
  ["CDEGHIJL", "EGJCHDLI"],
  ["CDEGHIJK", "EGJCHDIK"],
  ["CDEFIJKL", "CJEDIFLK"],
  ["CDEFHJKL", "CJEDHFLK"],
  ["CDEFHIKL", "CEIDHFLK"],
  ["CDEFHIJL", "CJEDHFLI"],
  ["CDEFHIJK", "CJEDHFIK"],
  ["CDEFGJKL", "CGEDJFLK"],
  ["CDEFGIKL", "CGEDIFLK"],
  ["CDEFGIJL", "CGEDJFLI"],
  ["CDEFGIJK", "CGEDJFIK"],
  ["CDEFGHKL", "CGEDHFLK"],
  ["CDEFGHJL", "CGJDHFLE"],
  ["CDEFGHJK", "CGJDHFEK"],
  ["CDEFGHIL", "CGEDHFLI"],
  ["CDEFGHIK", "CGEDHFIK"],
  ["CDEFGHIJ", "CGJDHFEI"],
  ["BFGHIJKL", "HJBFIGLK"],
  ["BEGHIJKL", "EJIBHGLK"],
  ["BEFHIJKL", "EJBFIHLK"],
  ["BEFGIJKL", "EJBFIGLK"],
  ["BEFGHJKL", "EJBFHGLK"],
  ["BEFGHIKL", "EGBFIHLK"],
  ["BEFGHIJL", "EJBFHGLI"],
  ["BEFGHIJK", "EJBFHGIK"],
  ["BDGHIJKL", "HJBDIGLK"],
  ["BDFHIJKL", "HJBDIFLK"],
  ["BDFGIJKL", "IGBDJFLK"],
  ["BDFGHJKL", "HGBDJFLK"],
  ["BDFGHIKL", "HGBDIFLK"],
  ["BDFGHIJL", "HGBDJFLI"],
  ["BDFGHIJK", "HGBDJFIK"],
  ["BDEHIJKL", "EJBDIHLK"],
  ["BDEGIJKL", "EJBDIGLK"],
  ["BDEGHJKL", "EJBDHGLK"],
  ["BDEGHIKL", "EGBDIHLK"],
  ["BDEGHIJL", "EJBDHGLI"],
  ["BDEGHIJK", "EJBDHGIK"],
  ["BDEFIJKL", "EJBDIFLK"],
  ["BDEFHJKL", "EJBDHFLK"],
  ["BDEFHIKL", "EIBDHFLK"],
  ["BDEFHIJL", "EJBDHFLI"],
  ["BDEFHIJK", "EJBDHFIK"],
  ["BDEFGJKL", "EGBDJFLK"],
  ["BDEFGIKL", "EGBDIFLK"],
  ["BDEFGIJL", "EGBDJFLI"],
  ["BDEFGIJK", "EGBDJFIK"],
  ["BDEFGHKL", "EGBDHFLK"],
  ["BDEFGHJL", "HGBDJFLE"],
  ["BDEFGHJK", "HGBDJFEK"],
  ["BDEFGHIL", "EGBDHFLI"],
  ["BDEFGHIK", "EGBDHFIK"],
  ["BDEFGHIJ", "HGBDJFEI"],
  ["BCGHIJKL", "HJBCIGLK"],
  ["BCFHIJKL", "HJBCIFLK"],
  ["BCFGIJKL", "IGBCJFLK"],
  ["BCFGHJKL", "HGBCJFLK"],
  ["BCFGHIKL", "HGBCIFLK"],
  ["BCFGHIJL", "HGBCJFLI"],
  ["BCFGHIJK", "HGBCJFIK"],
  ["BCEHIJKL", "EJBCIHLK"],
  ["BCEGIJKL", "EJBCIGLK"],
  ["BCEGHJKL", "EJBCHGLK"],
  ["BCEGHIKL", "EGBCIHLK"],
  ["BCEGHIJL", "EJBCHGLI"],
  ["BCEGHIJK", "EJBCHGIK"],
  ["BCEFIJKL", "EJBCIFLK"],
  ["BCEFHJKL", "EJBCHFLK"],
  ["BCEFHIKL", "EIBCHFLK"],
  ["BCEFHIJL", "EJBCHFLI"],
  ["BCEFHIJK", "EJBCHFIK"],
  ["BCEFGJKL", "EGBCJFLK"],
  ["BCEFGIKL", "EGBCIFLK"],
  ["BCEFGIJL", "EGBCJFLI"],
  ["BCEFGIJK", "EGBCJFIK"],
  ["BCEFGHKL", "EGBCHFLK"],
  ["BCEFGHJL", "HGBCJFLE"],
  ["BCEFGHJK", "HGBCJFEK"],
  ["BCEFGHIL", "EGBCHFLI"],
  ["BCEFGHIK", "EGBCHFIK"],
  ["BCEFGHIJ", "HGBCJFEI"],
  ["BCDHIJKL", "HJBCIDLK"],
  ["BCDGIJKL", "IGBCJDLK"],
  ["BCDGHJKL", "HGBCJDLK"],
  ["BCDGHIKL", "HGBCIDLK"],
  ["BCDGHIJL", "HGBCJDLI"],
  ["BCDGHIJK", "HGBCJDIK"],
  ["BCDFIJKL", "CJBDIFLK"],
  ["BCDFHJKL", "CJBDHFLK"],
  ["BCDFHIKL", "CIBDHFLK"],
  ["BCDFHIJL", "CJBDHFLI"],
  ["BCDFHIJK", "CJBDHFIK"],
  ["BCDFGJKL", "CGBDJFLK"],
  ["BCDFGIKL", "CGBDIFLK"],
  ["BCDFGIJL", "CGBDJFLI"],
  ["BCDFGIJK", "CGBDJFIK"],
  ["BCDFGHKL", "CGBDHFLK"],
  ["BCDFGHJL", "CGBDHFLJ"],
  ["BCDFGHJK", "HGBCJFDK"],
  ["BCDFGHIL", "CGBDHFLI"],
  ["BCDFGHIK", "CGBDHFIK"],
  ["BCDFGHIJ", "HGBCJFDI"],
  ["BCDEIJKL", "EJBCIDLK"],
  ["BCDEHJKL", "EJBCHDLK"],
  ["BCDEHIKL", "EIBCHDLK"],
  ["BCDEHIJL", "EJBCHDLI"],
  ["BCDEHIJK", "EJBCHDIK"],
  ["BCDEGJKL", "EGBCJDLK"],
  ["BCDEGIKL", "EGBCIDLK"],
  ["BCDEGIJL", "EGBCJDLI"],
  ["BCDEGIJK", "EGBCJDIK"],
  ["BCDEGHKL", "EGBCHDLK"],
  ["BCDEGHJL", "HGBCJDLE"],
  ["BCDEGHJK", "HGBCJDEK"],
  ["BCDEGHIL", "EGBCHDLI"],
  ["BCDEGHIK", "EGBCHDIK"],
  ["BCDEGHIJ", "HGBCJDEI"],
  ["BCDEFJKL", "CJBDEFLK"],
  ["BCDEFIKL", "CEBDIFLK"],
  ["BCDEFIJL", "CJBDEFLI"],
  ["BCDEFIJK", "CJBDEFIK"],
  ["BCDEFHKL", "CEBDHFLK"],
  ["BCDEFHJL", "CJBDHFLE"],
  ["BCDEFHJK", "CJBDHFEK"],
  ["BCDEFHIL", "CEBDHFLI"],
  ["BCDEFHIK", "CEBDHFIK"],
  ["BCDEFHIJ", "CJBDHFEI"],
  ["BCDEFGKL", "CGBDEFLK"],
  ["BCDEFGJL", "CGBDJFLE"],
  ["BCDEFGJK", "CGBDJFEK"],
  ["BCDEFGIL", "CGBDEFLI"],
  ["BCDEFGIK", "CGBDEFIK"],
  ["BCDEFGIJ", "CGBDJFEI"],
  ["BCDEFGHL", "CGBDHFLE"],
  ["BCDEFGHK", "CGBDHFEK"],
  ["BCDEFGHJ", "HGBCJFDE"],
  ["BCDEFGHI", "CGBDHFEI"],
  ["AFGHIJKL", "HJIFAGLK"],
  ["AEGHIJKL", "EJIAHGLK"],
  ["AEFHIJKL", "EJIFAHLK"],
  ["AEFGIJKL", "EJIFAGLK"],
  ["AEFGHJKL", "EGJFAHLK"],
  ["AEFGHIKL", "EGIFAHLK"],
  ["AEFGHIJL", "EGJFAHLI"],
  ["AEFGHIJK", "EGJFAHIK"],
  ["ADGHIJKL", "HJIDAGLK"],
  ["ADFHIJKL", "HJIDAFLK"],
  ["ADFGIJKL", "IGJDAFLK"],
  ["ADFGHJKL", "HGJDAFLK"],
  ["ADFGHIKL", "HGIDAFLK"],
  ["ADFGHIJL", "HGJDAFLI"],
  ["ADFGHIJK", "HGJDAFIK"],
  ["ADEHIJKL", "EJIDAHLK"],
  ["ADEGIJKL", "EJIDAGLK"],
  ["ADEGHJKL", "EGJDAHLK"],
  ["ADEGHIKL", "EGIDAHLK"],
  ["ADEGHIJL", "EGJDAHLI"],
  ["ADEGHIJK", "EGJDAHIK"],
  ["ADEFIJKL", "EJIDAFLK"],
  ["ADEFHJKL", "HJEDAFLK"],
  ["ADEFHIKL", "HEIDAFLK"],
  ["ADEFHIJL", "HJEDAFLI"],
  ["ADEFHIJK", "HJEDAFIK"],
  ["ADEFGJKL", "EGJDAFLK"],
  ["ADEFGIKL", "EGIDAFLK"],
  ["ADEFGIJL", "EGJDAFLI"],
  ["ADEFGIJK", "EGJDAFIK"],
  ["ADEFGHKL", "HGEDAFLK"],
  ["ADEFGHJL", "HGJDAFLE"],
  ["ADEFGHJK", "HGJDAFEK"],
  ["ADEFGHIL", "HGEDAFLI"],
  ["ADEFGHIK", "HGEDAFIK"],
  ["ADEFGHIJ", "HGJDAFEI"],
  ["ACGHIJKL", "HJICAGLK"],
  ["ACFHIJKL", "HJICAFLK"],
  ["ACFGIJKL", "IGJCAFLK"],
  ["ACFGHJKL", "HGJCAFLK"],
  ["ACFGHIKL", "HGICAFLK"],
  ["ACFGHIJL", "HGJCAFLI"],
  ["ACFGHIJK", "HGJCAFIK"],
  ["ACEHIJKL", "EJICAHLK"],
  ["ACEGIJKL", "EJICAGLK"],
  ["ACEGHJKL", "EGJCAHLK"],
  ["ACEGHIKL", "EGICAHLK"],
  ["ACEGHIJL", "EGJCAHLI"],
  ["ACEGHIJK", "EGJCAHIK"],
  ["ACEFIJKL", "EJICAFLK"],
  ["ACEFHJKL", "HJECAFLK"],
  ["ACEFHIKL", "HEICAFLK"],
  ["ACEFHIJL", "HJECAFLI"],
  ["ACEFHIJK", "HJECAFIK"],
  ["ACEFGJKL", "EGJCAFLK"],
  ["ACEFGIKL", "EGICAFLK"],
  ["ACEFGIJL", "EGJCAFLI"],
  ["ACEFGIJK", "EGJCAFIK"],
  ["ACEFGHKL", "HGECAFLK"],
  ["ACEFGHJL", "HGJCAFLE"],
  ["ACEFGHJK", "HGJCAFEK"],
  ["ACEFGHIL", "HGECAFLI"],
  ["ACEFGHIK", "HGECAFIK"],
  ["ACEFGHIJ", "HGJCAFEI"],
  ["ACDHIJKL", "HJICADLK"],
  ["ACDGIJKL", "IGJCADLK"],
  ["ACDGHJKL", "HGJCADLK"],
  ["ACDGHIKL", "HGICADLK"],
  ["ACDGHIJL", "HGJCADLI"],
  ["ACDGHIJK", "HGJCADIK"],
  ["ACDFIJKL", "CJIDAFLK"],
  ["ACDFHJKL", "HJFCADLK"],
  ["ACDFHIKL", "HFICADLK"],
  ["ACDFHIJL", "HJFCADLI"],
  ["ACDFHIJK", "HJFCADIK"],
  ["ACDFGJKL", "CGJDAFLK"],
  ["ACDFGIKL", "CGIDAFLK"],
  ["ACDFGIJL", "CGJDAFLI"],
  ["ACDFGIJK", "CGJDAFIK"],
  ["ACDFGHKL", "HGFCADLK"],
  ["ACDFGHJL", "CGJDAFLH"],
  ["ACDFGHJK", "HGJCAFDK"],
  ["ACDFGHIL", "HGFCADLI"],
  ["ACDFGHIK", "HGFCADIK"],
  ["ACDFGHIJ", "HGJCAFDI"],
  ["ACDEIJKL", "EJICADLK"],
  ["ACDEHJKL", "HJECADLK"],
  ["ACDEHIKL", "HEICADLK"],
  ["ACDEHIJL", "HJECADLI"],
  ["ACDEHIJK", "HJECADIK"],
  ["ACDEGJKL", "EGJCADLK"],
  ["ACDEGIKL", "EGICADLK"],
  ["ACDEGIJL", "EGJCADLI"],
  ["ACDEGIJK", "EGJCADIK"],
  ["ACDEGHKL", "HGECADLK"],
  ["ACDEGHJL", "HGJCADLE"],
  ["ACDEGHJK", "HGJCADEK"],
  ["ACDEGHIL", "HGECADLI"],
  ["ACDEGHIK", "HGECADIK"],
  ["ACDEGHIJ", "HGJCADEI"],
  ["ACDEFJKL", "CJEDAFLK"],
  ["ACDEFIKL", "CEIDAFLK"],
  ["ACDEFIJL", "CJEDAFLI"],
  ["ACDEFIJK", "CJEDAFIK"],
  ["ACDEFHKL", "HEFCADLK"],
  ["ACDEFHJL", "HJFCADLE"],
  ["ACDEFHJK", "HJECAFDK"],
  ["ACDEFHIL", "HEFCADLI"],
  ["ACDEFHIK", "HEFCADIK"],
  ["ACDEFHIJ", "HJECAFDI"],
  ["ACDEFGKL", "CGEDAFLK"],
  ["ACDEFGJL", "CGJDAFLE"],
  ["ACDEFGJK", "CGJDAFEK"],
  ["ACDEFGIL", "CGEDAFLI"],
  ["ACDEFGIK", "CGEDAFIK"],
  ["ACDEFGIJ", "CGJDAFEI"],
  ["ACDEFGHL", "HGFCADLE"],
  ["ACDEFGHK", "HGECAFDK"],
  ["ACDEFGHJ", "HGJCAFDE"],
  ["ACDEFGHI", "HGECAFDI"],
  ["ABGHIJKL", "HJBAIGLK"],
  ["ABFHIJKL", "HJBAIFLK"],
  ["ABFGIJKL", "IJBFAGLK"],
  ["ABFGHJKL", "HJBFAGLK"],
  ["ABFGHIKL", "HGBAIFLK"],
  ["ABFGHIJL", "HJBFAGLI"],
  ["ABFGHIJK", "HJBFAGIK"],
  ["ABEHIJKL", "EJBAIHLK"],
  ["ABEGIJKL", "EJBAIGLK"],
  ["ABEGHJKL", "EJBAHGLK"],
  ["ABEGHIKL", "EGBAIHLK"],
  ["ABEGHIJL", "EJBAHGLI"],
  ["ABEGHIJK", "EJBAHGIK"],
  ["ABEFIJKL", "EJBAIFLK"],
  ["ABEFHJKL", "EJBFAHLK"],
  ["ABEFHIKL", "EIBFAHLK"],
  ["ABEFHIJL", "EJBFAHLI"],
  ["ABEFHIJK", "EJBFAHIK"],
  ["ABEFGJKL", "EJBFAGLK"],
  ["ABEFGIKL", "EGBAIFLK"],
  ["ABEFGIJL", "EJBFAGLI"],
  ["ABEFGIJK", "EJBFAGIK"],
  ["ABEFGHKL", "EGBFAHLK"],
  ["ABEFGHJL", "HJBFAGLE"],
  ["ABEFGHJK", "HJBFAGEK"],
  ["ABEFGHIL", "EGBFAHLI"],
  ["ABEFGHIK", "EGBFAHIK"],
  ["ABEFGHIJ", "HJBFAGEI"],
  ["ABDHIJKL", "IJBDAHLK"],
  ["ABDGIJKL", "IJBDAGLK"],
  ["ABDGHJKL", "HJBDAGLK"],
  ["ABDGHIKL", "IGBDAHLK"],
  ["ABDGHIJL", "HJBDAGLI"],
  ["ABDGHIJK", "HJBDAGIK"],
  ["ABDFIJKL", "IJBDAFLK"],
  ["ABDFHJKL", "HJBDAFLK"],
  ["ABDFHIKL", "HIBDAFLK"],
  ["ABDFHIJL", "HJBDAFLI"],
  ["ABDFHIJK", "HJBDAFIK"],
  ["ABDFGJKL", "FJBDAGLK"],
  ["ABDFGIKL", "IGBDAFLK"],
  ["ABDFGIJL", "FJBDAGLI"],
  ["ABDFGIJK", "FJBDAGIK"],
  ["ABDFGHKL", "HGBDAFLK"],
  ["ABDFGHJL", "HGBDAFLJ"],
  ["ABDFGHJK", "HGBDAFJK"],
  ["ABDFGHIL", "HGBDAFLI"],
  ["ABDFGHIK", "HGBDAFIK"],
  ["ABDFGHIJ", "HGBDAFIJ"],
  ["ABDEIJKL", "EJBAIDLK"],
  ["ABDEHJKL", "EJBDAHLK"],
  ["ABDEHIKL", "EIBDAHLK"],
  ["ABDEHIJL", "EJBDAHLI"],
  ["ABDEHIJK", "EJBDAHIK"],
  ["ABDEGJKL", "EJBDAGLK"],
  ["ABDEGIKL", "EGBAIDLK"],
  ["ABDEGIJL", "EJBDAGLI"],
  ["ABDEGIJK", "EJBDAGIK"],
  ["ABDEGHKL", "EGBDAHLK"],
  ["ABDEGHJL", "HJBDAGLE"],
  ["ABDEGHJK", "HJBDAGEK"],
  ["ABDEGHIL", "EGBDAHLI"],
  ["ABDEGHIK", "EGBDAHIK"],
  ["ABDEGHIJ", "HJBDAGEI"],
  ["ABDEFJKL", "EJBDAFLK"],
  ["ABDEFIKL", "EIBDAFLK"],
  ["ABDEFIJL", "EJBDAFLI"],
  ["ABDEFIJK", "EJBDAFIK"],
  ["ABDEFHKL", "HEBDAFLK"],
  ["ABDEFHJL", "HJBDAFLE"],
  ["ABDEFHJK", "HJBDAFEK"],
  ["ABDEFHIL", "HEBDAFLI"],
  ["ABDEFHIK", "HEBDAFIK"],
  ["ABDEFHIJ", "HJBDAFEI"],
  ["ABDEFGKL", "EGBDAFLK"],
  ["ABDEFGJL", "EGBDAFLJ"],
  ["ABDEFGJK", "EGBDAFJK"],
  ["ABDEFGIL", "EGBDAFLI"],
  ["ABDEFGIK", "EGBDAFIK"],
  ["ABDEFGIJ", "EGBDAFIJ"],
  ["ABDEFGHL", "HGBDAFLE"],
  ["ABDEFGHK", "HGBDAFEK"],
  ["ABDEFGHJ", "HGBDAFEJ"],
  ["ABDEFGHI", "HGBDAFEI"],
  ["ABCHIJKL", "IJBCAHLK"],
  ["ABCGIJKL", "IJBCAGLK"],
  ["ABCGHJKL", "HJBCAGLK"],
  ["ABCGHIKL", "IGBCAHLK"],
  ["ABCGHIJL", "HJBCAGLI"],
  ["ABCGHIJK", "HJBCAGIK"],
  ["ABCFIJKL", "IJBCAFLK"],
  ["ABCFHJKL", "HJBCAFLK"],
  ["ABCFHIKL", "HIBCAFLK"],
  ["ABCFHIJL", "HJBCAFLI"],
  ["ABCFHIJK", "HJBCAFIK"],
  ["ABCFGJKL", "CJBFAGLK"],
  ["ABCFGIKL", "IGBCAFLK"],
  ["ABCFGIJL", "CJBFAGLI"],
  ["ABCFGIJK", "CJBFAGIK"],
  ["ABCFGHKL", "HGBCAFLK"],
  ["ABCFGHJL", "HGBCAFLJ"],
  ["ABCFGHJK", "HGBCAFJK"],
  ["ABCFGHIL", "HGBCAFLI"],
  ["ABCFGHIK", "HGBCAFIK"],
  ["ABCFGHIJ", "HGBCAFIJ"],
  ["ABCEIJKL", "EJBAICLK"],
  ["ABCEHJKL", "EJBCAHLK"],
  ["ABCEHIKL", "EIBCAHLK"],
  ["ABCEHIJL", "EJBCAHLI"],
  ["ABCEHIJK", "EJBCAHIK"],
  ["ABCEGJKL", "EJBCAGLK"],
  ["ABCEGIKL", "EGBAICLK"],
  ["ABCEGIJL", "EJBCAGLI"],
  ["ABCEGIJK", "EJBCAGIK"],
  ["ABCEGHKL", "EGBCAHLK"],
  ["ABCEGHJL", "HJBCAGLE"],
  ["ABCEGHJK", "HJBCAGEK"],
  ["ABCEGHIL", "EGBCAHLI"],
  ["ABCEGHIK", "EGBCAHIK"],
  ["ABCEGHIJ", "HJBCAGEI"],
  ["ABCEFJKL", "EJBCAFLK"],
  ["ABCEFIKL", "EIBCAFLK"],
  ["ABCEFIJL", "EJBCAFLI"],
  ["ABCEFIJK", "EJBCAFIK"],
  ["ABCEFHKL", "HEBCAFLK"],
  ["ABCEFHJL", "HJBCAFLE"],
  ["ABCEFHJK", "HJBCAFEK"],
  ["ABCEFHIL", "HEBCAFLI"],
  ["ABCEFHIK", "HEBCAFIK"],
  ["ABCEFHIJ", "HJBCAFEI"],
  ["ABCEFGKL", "EGBCAFLK"],
  ["ABCEFGJL", "EGBCAFLJ"],
  ["ABCEFGJK", "EGBCAFJK"],
  ["ABCEFGIL", "EGBCAFLI"],
  ["ABCEFGIK", "EGBCAFIK"],
  ["ABCEFGIJ", "EGBCAFIJ"],
  ["ABCEFGHL", "HGBCAFLE"],
  ["ABCEFGHK", "HGBCAFEK"],
  ["ABCEFGHJ", "HGBCAFEJ"],
  ["ABCEFGHI", "HGBCAFEI"],
  ["ABCDIJKL", "IJBCADLK"],
  ["ABCDHJKL", "HJBCADLK"],
  ["ABCDHIKL", "HIBCADLK"],
  ["ABCDHIJL", "HJBCADLI"],
  ["ABCDHIJK", "HJBCADIK"],
  ["ABCDGJKL", "CJBDAGLK"],
  ["ABCDGIKL", "IGBCADLK"],
  ["ABCDGIJL", "CJBDAGLI"],
  ["ABCDGIJK", "CJBDAGIK"],
  ["ABCDGHKL", "HGBCADLK"],
  ["ABCDGHJL", "HGBCADLJ"],
  ["ABCDGHJK", "HGBCADJK"],
  ["ABCDGHIL", "HGBCADLI"],
  ["ABCDGHIK", "HGBCADIK"],
  ["ABCDGHIJ", "HGBCADIJ"],
  ["ABCDFJKL", "CJBDAFLK"],
  ["ABCDFIKL", "CIBDAFLK"],
  ["ABCDFIJL", "CJBDAFLI"],
  ["ABCDFIJK", "CJBDAFIK"],
  ["ABCDFHKL", "HFBCADLK"],
  ["ABCDFHJL", "CJBDAFLH"],
  ["ABCDFHJK", "HJBCAFDK"],
  ["ABCDFHIL", "HFBCADLI"],
  ["ABCDFHIK", "HFBCADIK"],
  ["ABCDFHIJ", "HJBCAFDI"],
  ["ABCDFGKL", "CGBDAFLK"],
  ["ABCDFGJL", "CGBDAFLJ"],
  ["ABCDFGJK", "CGBDAFJK"],
  ["ABCDFGIL", "CGBDAFLI"],
  ["ABCDFGIK", "CGBDAFIK"],
  ["ABCDFGIJ", "CGBDAFIJ"],
  ["ABCDFGHL", "CGBDAFLH"],
  ["ABCDFGHK", "HGBCAFDK"],
  ["ABCDFGHJ", "HGBCAFDJ"],
  ["ABCDFGHI", "HGBCAFDI"],
  ["ABCDEJKL", "EJBCADLK"],
  ["ABCDEIKL", "EIBCADLK"],
  ["ABCDEIJL", "EJBCADLI"],
  ["ABCDEIJK", "EJBCADIK"],
  ["ABCDEHKL", "HEBCADLK"],
  ["ABCDEHJL", "HJBCADLE"],
  ["ABCDEHJK", "HJBCADEK"],
  ["ABCDEHIL", "HEBCADLI"],
  ["ABCDEHIK", "HEBCADIK"],
  ["ABCDEHIJ", "HJBCADEI"],
  ["ABCDEGKL", "EGBCADLK"],
  ["ABCDEGJL", "EGBCADLJ"],
  ["ABCDEGJK", "EGBCADJK"],
  ["ABCDEGIL", "EGBCADLI"],
  ["ABCDEGIK", "EGBCADIK"],
  ["ABCDEGIJ", "EGBCADIJ"],
  ["ABCDEGHL", "HGBCADLE"],
  ["ABCDEGHK", "HGBCADEK"],
  ["ABCDEGHJ", "HGBCADEJ"],
  ["ABCDEGHI", "HGBCADEI"],
  ["ABCDEFKL", "CEBDAFLK"],
  ["ABCDEFJL", "CJBDAFLE"],
  ["ABCDEFJK", "CJBDAFEK"],
  ["ABCDEFIL", "CEBDAFLI"],
  ["ABCDEFIK", "CEBDAFIK"],
  ["ABCDEFIJ", "CJBDAFEI"],
  ["ABCDEFHL", "HFBCADLE"],
  ["ABCDEFHK", "HEBCAFDK"],
  ["ABCDEFHJ", "HJBCAFDE"],
  ["ABCDEFHI", "HEBCAFDI"],
  ["ABCDEFGL", "CGBDAFLE"],
  ["ABCDEFGK", "CGBDAFEK"],
  ["ABCDEFGJ", "CGBDAFEJ"],
  ["ABCDEFGI", "CGBDAFEI"],
  ["ABCDEFGH", "HGBCAFDE"],
] as const satisfies readonly ThirdPlaceAssignmentRow[];

const THIRD_PLACE_ASSIGNMENT_MAP = new Map<ThirdPlaceCombinationKey, ThirdPlaceAssignmentCode>(
  THIRD_PLACE_ASSIGNMENT_ROWS
);
const GROUP_ORDER = new Map<GroupId, number>(GROUP_IDS.map((group, index) => [group, index]));

export const ROUND_OF_32_MATCHES = [
  { matchNumber: 73, stage: "R32", home: { type: "runnerUp", group: "A" }, away: { type: "runnerUp", group: "B" } },
  {
    matchNumber: 74,
    stage: "R32",
    home: { type: "winner", group: "E" },
    away: { type: "thirdPlace", slotWinnerGroup: "E" },
  },
  { matchNumber: 75, stage: "R32", home: { type: "winner", group: "F" }, away: { type: "runnerUp", group: "C" } },
  { matchNumber: 76, stage: "R32", home: { type: "winner", group: "C" }, away: { type: "runnerUp", group: "F" } },
  {
    matchNumber: 77,
    stage: "R32",
    home: { type: "winner", group: "I" },
    away: { type: "thirdPlace", slotWinnerGroup: "I" },
  },
  { matchNumber: 78, stage: "R32", home: { type: "runnerUp", group: "E" }, away: { type: "runnerUp", group: "I" } },
  {
    matchNumber: 79,
    stage: "R32",
    home: { type: "winner", group: "A" },
    away: { type: "thirdPlace", slotWinnerGroup: "A" },
  },
  {
    matchNumber: 80,
    stage: "R32",
    home: { type: "winner", group: "L" },
    away: { type: "thirdPlace", slotWinnerGroup: "L" },
  },
  {
    matchNumber: 81,
    stage: "R32",
    home: { type: "winner", group: "D" },
    away: { type: "thirdPlace", slotWinnerGroup: "D" },
  },
  {
    matchNumber: 82,
    stage: "R32",
    home: { type: "winner", group: "G" },
    away: { type: "thirdPlace", slotWinnerGroup: "G" },
  },
  { matchNumber: 83, stage: "R32", home: { type: "runnerUp", group: "K" }, away: { type: "runnerUp", group: "L" } },
  { matchNumber: 84, stage: "R32", home: { type: "winner", group: "H" }, away: { type: "runnerUp", group: "J" } },
  {
    matchNumber: 85,
    stage: "R32",
    home: { type: "winner", group: "B" },
    away: { type: "thirdPlace", slotWinnerGroup: "B" },
  },
  { matchNumber: 86, stage: "R32", home: { type: "winner", group: "J" }, away: { type: "runnerUp", group: "H" } },
  {
    matchNumber: 87,
    stage: "R32",
    home: { type: "winner", group: "K" },
    away: { type: "thirdPlace", slotWinnerGroup: "K" },
  },
  { matchNumber: 88, stage: "R32", home: { type: "runnerUp", group: "D" }, away: { type: "runnerUp", group: "G" } },
] as const satisfies readonly RoundOf32MatchTemplate[];

export const ROUND_OF_16_MATCHES = [
  { matchNumber: 89, stage: "R16", homeSourceMatchNumber: 74, awaySourceMatchNumber: 77 },
  { matchNumber: 90, stage: "R16", homeSourceMatchNumber: 73, awaySourceMatchNumber: 75 },
  { matchNumber: 91, stage: "R16", homeSourceMatchNumber: 76, awaySourceMatchNumber: 78 },
  { matchNumber: 92, stage: "R16", homeSourceMatchNumber: 79, awaySourceMatchNumber: 80 },
  { matchNumber: 93, stage: "R16", homeSourceMatchNumber: 83, awaySourceMatchNumber: 84 },
  { matchNumber: 94, stage: "R16", homeSourceMatchNumber: 81, awaySourceMatchNumber: 82 },
  { matchNumber: 95, stage: "R16", homeSourceMatchNumber: 86, awaySourceMatchNumber: 88 },
  { matchNumber: 96, stage: "R16", homeSourceMatchNumber: 85, awaySourceMatchNumber: 87 },
] as const satisfies readonly PreviousWinnerMatchTemplate[];

export const QUARTER_FINAL_MATCHES = [
  { matchNumber: 97, stage: "QF", homeSourceMatchNumber: 89, awaySourceMatchNumber: 90 },
  { matchNumber: 98, stage: "QF", homeSourceMatchNumber: 93, awaySourceMatchNumber: 94 },
  { matchNumber: 99, stage: "QF", homeSourceMatchNumber: 91, awaySourceMatchNumber: 92 },
  { matchNumber: 100, stage: "QF", homeSourceMatchNumber: 95, awaySourceMatchNumber: 96 },
] as const satisfies readonly PreviousWinnerMatchTemplate[];

export const SEMI_FINAL_MATCHES = [
  { matchNumber: 101, stage: "SF", homeSourceMatchNumber: 97, awaySourceMatchNumber: 98 },
  { matchNumber: 102, stage: "SF", homeSourceMatchNumber: 99, awaySourceMatchNumber: 100 },
] as const satisfies readonly PreviousWinnerMatchTemplate[];

export const FINAL_MATCHES = [
  { matchNumber: 104, stage: "F", homeSourceMatchNumber: 101, awaySourceMatchNumber: 102 },
] as const satisfies readonly PreviousWinnerMatchTemplate[];

const KNOCKOUT_MATCH_METADATA = new Map<number, KnockoutMatchMetadata>([
  [73, { date: "2026-06-28", venue: "Los Angeles" }],
  [74, { date: "2026-06-29", venue: "Boston" }],
  [75, { date: "2026-06-29", venue: "Monterrey" }],
  [76, { date: "2026-06-29", venue: "Houston" }],
  [77, { date: "2026-06-30", venue: "New York New Jersey" }],
  [78, { date: "2026-06-30", venue: "Dallas" }],
  [79, { date: "2026-06-30", venue: "Mexico City" }],
  [80, { date: "2026-07-01", venue: "Atlanta" }],
  [81, { date: "2026-07-01", venue: "San Francisco Bay Area" }],
  [82, { date: "2026-07-01", venue: "Seattle" }],
  [83, { date: "2026-07-02", venue: "Toronto" }],
  [84, { date: "2026-07-02", venue: "Los Angeles" }],
  [85, { date: "2026-07-02", venue: "Vancouver" }],
  [86, { date: "2026-07-03", venue: "Miami" }],
  [87, { date: "2026-07-03", venue: "Kansas City" }],
  [88, { date: "2026-07-03", venue: "Dallas" }],
  [89, { date: "2026-07-04", venue: "Philadelphia" }],
  [90, { date: "2026-07-04", venue: "Houston" }],
  [91, { date: "2026-07-05", venue: "New York New Jersey" }],
  [92, { date: "2026-07-05", venue: "Mexico City" }],
  [93, { date: "2026-07-06", venue: "Dallas" }],
  [94, { date: "2026-07-06", venue: "Seattle" }],
  [95, { date: "2026-07-07", venue: "Atlanta" }],
  [96, { date: "2026-07-07", venue: "Vancouver" }],
  [97, { date: "2026-07-09", venue: "Boston" }],
  [98, { date: "2026-07-10", venue: "Los Angeles" }],
  [99, { date: "2026-07-11", venue: "Miami" }],
  [100, { date: "2026-07-11", venue: "Kansas City" }],
  [101, { date: "2026-07-14", venue: "Dallas" }],
  [102, { date: "2026-07-15", venue: "Atlanta" }],
  [104, { date: "2026-07-19", venue: "New York New Jersey" }],
]);

function isGroupId(value: string): value is GroupId {
  return GROUP_IDS.includes(value as GroupId);
}

function getGroupSortValue(group: GroupId): number {
  const sortValue = GROUP_ORDER.get(group);
  if (sortValue === undefined) {
    throw new Error(`Unknown group: ${group}`);
  }
  return sortValue;
}

function getThirdPlaceCombinationKey(qualifiedThirdPlaceGroups: readonly GroupId[]): ThirdPlaceCombinationKey {
  const uniqueGroups = new Set(qualifiedThirdPlaceGroups);
  if (qualifiedThirdPlaceGroups.length !== 8 || uniqueGroups.size !== 8) {
    throw new Error("Exactly eight unique third-place groups are required");
  }

  for (const group of qualifiedThirdPlaceGroups) {
    if (!isGroupId(group)) {
      throw new Error(`Unknown third-place group: ${group}`);
    }
  }

  return [...uniqueGroups].sort((a, b) => getGroupSortValue(a) - getGroupSortValue(b)).join("");
}

export function getThirdPlaceAssignment(qualifiedThirdPlaceGroups: readonly GroupId[]): ThirdPlaceAssignment {
  const combinationKey = getThirdPlaceCombinationKey(qualifiedThirdPlaceGroups);
  const assignmentCode = THIRD_PLACE_ASSIGNMENT_MAP.get(combinationKey);
  if (!assignmentCode) {
    throw new Error(`Unsupported third-place combination: ${combinationKey}`);
  }

  return Object.fromEntries(
    THIRD_PLACE_ASSIGNMENT_SLOT_GROUPS.map((slotGroup, index) => {
      const assignedGroup = assignmentCode[index];
      if (!assignedGroup || !isGroupId(assignedGroup)) {
        throw new Error(`Invalid third-place assignment ${assignmentCode} for ${combinationKey}`);
      }
      return [slotGroup, assignedGroup];
    })
  ) as ThirdPlaceAssignment;
}

function getTeamByGroup(
  teamsByGroup: Partial<Record<GroupId, TournamentTeam>>,
  group: GroupId,
  seedLabel: string
): TournamentTeam {
  const team = teamsByGroup[group];
  if (!team) {
    throw new Error(`Missing ${seedLabel} team for Group ${group}`);
  }
  return team;
}

function resolveRoundOf32Seed(
  seed: RoundOf32Seed,
  groupWinners: Record<GroupId, TournamentTeam>,
  groupRunnersUp: Record<GroupId, TournamentTeam>,
  qualifiedThirdPlaceTeams: Partial<Record<GroupId, TournamentTeam>>,
  thirdPlaceAssignment: ThirdPlaceAssignment
): { team: TournamentTeam; seed: ResolvedKnockoutSeed } {
  if (seed.type === "winner") {
    return {
      team: getTeamByGroup(groupWinners, seed.group, "winner"),
      seed,
    };
  }

  if (seed.type === "runnerUp") {
    return {
      team: getTeamByGroup(groupRunnersUp, seed.group, "runner-up"),
      seed,
    };
  }

  const thirdPlaceGroup = thirdPlaceAssignment[seed.slotWinnerGroup];
  return {
    team: getTeamByGroup(qualifiedThirdPlaceTeams, thirdPlaceGroup, "third-place"),
    seed,
  };
}

function assertUniqueMatchTeams(matches: readonly KnockoutMatch[], expectedTeamCount: number): void {
  const teamNames = matches.flatMap((match) => [match.home.name, match.away.name]);
  const uniqueTeamNames = new Set(teamNames);

  if (teamNames.length !== expectedTeamCount || uniqueTeamNames.size !== expectedTeamCount) {
    throw new Error(`Knockout bracket must contain ${expectedTeamCount} unique teams`);
  }
}

export function buildRoundOf32Matches(
  groupWinners: Record<GroupId, TournamentTeam>,
  groupRunnersUp: Record<GroupId, TournamentTeam>,
  qualifiedThirdPlaceTeams: Partial<Record<GroupId, TournamentTeam>>
): KnockoutMatch[] {
  const thirdPlaceAssignment = getThirdPlaceAssignment(Object.keys(qualifiedThirdPlaceTeams) as GroupId[]);
  const matches = ROUND_OF_32_MATCHES.map((template) => {
    const home = resolveRoundOf32Seed(
      template.home,
      groupWinners,
      groupRunnersUp,
      qualifiedThirdPlaceTeams,
      thirdPlaceAssignment
    );
    const away = resolveRoundOf32Seed(
      template.away,
      groupWinners,
      groupRunnersUp,
      qualifiedThirdPlaceTeams,
      thirdPlaceAssignment
    );

    return {
      matchNumber: template.matchNumber,
      stage: template.stage,
      home: home.team,
      away: away.team,
      homeSeed: home.seed,
      awaySeed: away.seed,
      ...getKnockoutMatchMetadata(template.matchNumber),
    };
  });

  assertUniqueMatchTeams(matches, 32);
  return matches;
}

function getPreviousWinner(winnersByMatchNumber: ReadonlyMap<number, TournamentTeam>, matchNumber: number): TournamentTeam {
  const team = winnersByMatchNumber.get(matchNumber);
  if (!team) {
    throw new Error(`Missing winner for match ${matchNumber}`);
  }
  return team;
}

function getKnockoutMatchMetadata(matchNumber: number): KnockoutMatchMetadata {
  const metadata = KNOCKOUT_MATCH_METADATA.get(matchNumber);

  if (!metadata) {
    throw new Error(`Missing knockout metadata for match ${matchNumber}`);
  }

  return { ...metadata };
}

export function buildMatchesFromPreviousWinners(
  templates: readonly PreviousWinnerMatchTemplate[],
  winnersByMatchNumber: ReadonlyMap<number, TournamentTeam>
): KnockoutMatch[] {
  const matches = templates.map(
    (template): KnockoutMatch => ({
      matchNumber: template.matchNumber,
      stage: template.stage,
      home: getPreviousWinner(winnersByMatchNumber, template.homeSourceMatchNumber),
      away: getPreviousWinner(winnersByMatchNumber, template.awaySourceMatchNumber),
      homeSeed: {
        type: "previousWinner",
        sourceMatchNumber: template.homeSourceMatchNumber,
      },
      awaySeed: {
        type: "previousWinner",
        sourceMatchNumber: template.awaySourceMatchNumber,
      },
      ...getKnockoutMatchMetadata(template.matchNumber),
    })
  );

  assertUniqueMatchTeams(matches, templates.length * 2);
  return matches;
}
