-- Adds 180 fake leaderboard entries (social-proof/demo purposes) that rank
-- alongside real players instead of replacing them. Usernames are
-- internationally varied. Avatars are locally-generated on-brand images
-- (public/avatars/) mixing bold icon glyphs (camera, plane, star, crown,
-- compass, etc.) with initials-on-gradient, for visual variety without
-- depicting any real or fake-but-photorealistic human face - using a real
-- person's likeness (site content or otherwise) to represent a fabricated
-- player identity would misattribute them without consent.
--
-- Score math: submit-round's real per-round score is baseScore (capped at
-- 5000) times a speed multiplier of up to 1.5x, so the true ceiling is
-- 7500/round - 37500 for a 5-round game, not 5000/25000. Points-per-game
-- here ranges from ~5500-8000 (casual, few games - in line with what a
-- brand-new real player can already score in a single quick game) up to
-- ~24000-28000 (dedicated, skilled, hundreds of games), always comfortably
-- under the 37500 hard cap so no row implies a mathematically perfect
-- player.
--
-- Real players are completely unaffected: their totals are still computed
-- live from game_scores exactly as before (see migration-leaderboard-
-- premium.sql), and the combined list is re-sorted by total_score, so a
-- real player naturally ranks above or below a fake entry based on their
-- actual score - same as competing against any other player. Nothing about
-- game_scores, profiles, or the game flow is touched. The limit is raised
-- from 50 to 200 so all 180 fake rows plus real players remain available to
-- the RPC (the Leaderboard screen itself now renders the top 100:
-- src/screens/Leaderboard.tsx).
--
-- The 180 rows live in a real table (fake_leaderboard_entries), not a
-- hardcoded list, specifically so you can edit them later without touching
-- SQL: Supabase Dashboard -> Table Editor -> fake_leaderboard_entries, open
-- a row, fill in instagram_handle / facebook_handle / avatar_url / whatever,
-- save. Use handles you actually own or have permission for - inventing
-- random ones risks linking to an unrelated real person's real account.
--
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run, including to pick
-- up a future update to this file (e.g. corrected scores): the insert
-- upserts on username, refreshing total_score / games_played / avatar_url /
-- is_premium / last_played_at each time, while leaving instagram_handle and
-- facebook_handle alone - so a re-run never wipes out edits you've made in
-- the Table Editor, but it WILL refresh a stale run from an older version
-- of this file (the DB doesn't auto-sync with the repo - re-running this
-- file after every edit is what actually applies a change).

create table if not exists public.fake_leaderboard_entries (
  id serial primary key,
  username text not null unique,
  total_score bigint not null,
  games_played bigint not null,
  last_played_at timestamptz not null,
  avatar_url text,
  instagram_handle text,
  facebook_handle text,
  is_premium boolean not null default false
);

-- RLS on with no policies: not readable by anon/authenticated directly.
-- get_leaderboard() below is security definer so it reads this table
-- regardless of RLS, and the Table Editor uses the postgres role which
-- also bypasses RLS - so you can still edit rows freely from the dashboard.
alter table public.fake_leaderboard_entries enable row level security;

insert into public.fake_leaderboard_entries
  (username, total_score, games_played, last_played_at, avatar_url, instagram_handle, facebook_handle, is_premium)
values
  ('JihoKim43', 8415005, 307, now() - interval '43 hours', '/avatars/9.webp', null, null, true),
  ('GeoEmber270', 8407990, 312, now() - interval '132 hours', '/avatars/13.webp', null, null, true),
  ('KenjiWatanabe64', 8389853, 320, now() - interval '206 hours', '/avatars/22.webp', null, null, true),
  ('TerraHunter', 8315669, 317, now() - interval '79 hours', '/avatars/6.webp', null, null, true),
  ('MarinaOrlova69', 8098090, 301, now() - interval '83 hours', '/avatars/1.webp', null, null, true),
  ('MateoRojas', 7735518, 339, now() - interval '77 hours', '/avatars/2.webp', null, null, true),
  ('AminaMwangi', 7726985, 293, now() - interval '108 hours', '/avatars/21.webp', null, null, true),
  ('Hunter_36', 7660488, 313, now() - interval '8 hours', '/avatars/10.webp', null, null, true),
  ('KacperKaminski', 7583514, 307, now() - interval '134 hours', '/avatars/17.webp', null, null, true),
  ('Liam_Morgan', 7429122, 307, now() - interval '33 hours', '/avatars/8.webp', null, null, true),
  ('SebastianHerrera1', 7327551, 306, now() - interval '265 hours', '/avatars/33.webp', null, null, true),
  ('FelixZimmermann', 7116242, 288, now() - interval '60 hours', '/avatars/7.webp', null, null, true),
  ('KatrinKrueger', 7108627, 292, now() - interval '278 hours', '/avatars/28.webp', null, null, true),
  ('Nina_Krueger', 7075746, 264, now() - interval '65 hours', '/avatars/12.webp', null, null, true),
  ('Dmitri.Sokolov', 7048060, 326, now() - interval '93 hours', '/avatars/11.webp', null, null, true),
  ('Valentina_Greco', 7043641, 293, now() - interval '175 hours', '/avatars/46.webp', null, null, true),
  ('Fatoumata_Mwangi', 7009170, 314, now() - interval '88 hours', '/avatars/26.webp', null, null, true),
  ('ChidiDiallo', 6998534, 343, now() - interval '132 hours', '/avatars/16.webp', null, null, true),
  ('EmmaTurner', 6902527, 287, now() - interval '376 hours', '/avatars/47.webp', null, null, false),
  ('AgnieszkaWisniewski', 6792520, 280, now() - interval '121 hours', '/avatars/27.webp', null, null, true),
  ('ArmanTran22', 6702342, 335, now() - interval '17 hours', '/avatars/14.webp', null, null, true),
  ('KarimSaleh', 6689686, 302, now() - interval '134 hours', '/avatars/36.webp', null, null, true),
  ('GlobeFalcon257', 6682046, 315, now() - interval '85 hours', '/avatars/3.webp', null, null, false),
  ('Jonas_Wagner', 6581899, 294, now() - interval '414 hours', '/avatars/53.webp', null, null, false),
  ('AmaraMensah', 6496083, 282, now() - interval '10 hours', '/avatars/31.webp', null, null, true),
  ('PaulVoigt', 6463912, 294, now() - interval '270 hours', '/avatars/29.webp', null, null, true),
  ('Scout_27', 6459774, 278, now() - interval '15 hours', '/avatars/34.webp', null, null, true),
  ('AtlasRanger764', 6455412, 281, now() - interval '118 hours', '/avatars/18.webp', null, null, true),
  ('JulienGirard', 6446667, 314, now() - interval '27 hours', '/avatars/15.webp', null, null, true),
  ('Wei.Wong', 6435952, 271, now() - interval '35 hours', '/avatars/5.webp', null, null, true),
  ('HanaChen', 6405842, 288, now() - interval '324 hours', '/avatars/45.webp', null, null, true),
  ('JonasSchaefer', 6404572, 262, now() - interval '281 hours', '/avatars/35.webp', null, null, true),
  ('Mai_Hutomo', 6389293, 313, now() - interval '169 hours', '/avatars/24.webp', null, null, true),
  ('ZofiaWojcik82', 6377410, 282, now() - interval '65 hours', '/avatars/55.webp', null, null, false),
  ('Hugo.Rousseau', 6371052, 293, now() - interval '36 hours', '/avatars/25.webp', null, null, false),
  ('LarsSolberg59', 6188951, 303, now() - interval '216 hours', '/avatars/20.webp', null, null, false),
  ('ChloeSharpe', 5975186, 306, now() - interval '273 hours', '/avatars/43.webp', null, null, true),
  ('Nathan.Blanchard', 5957489, 288, now() - interval '500 hours', '/avatars/57.webp', null, null, false),
  ('AstridBerg', 5881988, 254, now() - interval '45 hours', '/avatars/30.webp', null, null, false),
  ('PixelExplorer', 5851419, 268, now() - interval '19 hours', '/avatars/23.webp', null, null, true),
  ('BarisOzturk62', 5838387, 264, now() - interval '422 hours', '/avatars/58.webp', null, null, true),
  ('KenjiNakamura', 5817113, 291, now() - interval '108 hours', '/avatars/41.webp', null, null, false),
  ('Linh_Reyes', 5808581, 269, now() - interval '7 hours', '/avatars/4.webp', null, null, true),
  ('Hunter_26', 5792577, 267, now() - interval '363 hours', '/avatars/63.webp', null, null, true),
  ('IvanSokolov', 5703176, 256, now() - interval '40 hours', '/avatars/19.webp', null, null, true),
  ('AliceBlanchard31', 5674321, 242, now() - interval '73 hours', '/avatars/51.webp', null, null, true),
  ('SaraKaram', 5631463, 259, now() - interval '143 hours', '/avatars/52.webp', null, null, true),
  ('DiyaKapoor', 5614013, 290, now() - interval '285 hours', '/avatars/37.webp', null, null, true),
  ('Drifter_14', 5585731, 292, now() - interval '194 hours', '/avatars/39.webp', null, null, true),
  ('MapRonin', 5522035, 257, now() - interval '135 hours', '/avatars/42.webp', null, null, false),
  ('WiktorKaminski', 5434867, 257, now() - interval '33 hours', '/avatars/32.webp', null, null, false),
  ('ChiaraEsposito', 5302297, 240, now() - interval '263 hours', '/avatars/66.webp', null, null, false),
  ('AlejandroSalazar', 5256610, 276, now() - interval '204 hours', '/avatars/48.webp', null, null, true),
  ('MiaWagner19', 5184299, 262, now() - interval '323 hours', '/avatars/67.webp', null, null, true),
  ('Kacper_Zielinski', 5128882, 278, now() - interval '166 hours', '/avatars/40.webp', null, null, false),
  ('Ravi.Cruz', 5079590, 237, now() - interval '76 hours', '/avatars/38.webp', null, null, true),
  ('AliceFaure', 5068583, 258, now() - interval '35 hours', '/avatars/73.webp', null, null, true),
  ('BrunoBarros', 5060579, 232, now() - interval '121 hours', '/avatars/54.webp', null, null, true),
  ('AndreiKuznetsov88', 4952206, 251, now() - interval '79 hours', '/avatars/78.webp', null, null, true),
  ('AmiraHaddad', 4830185, 252, now() - interval '241 hours', '/avatars/61.webp', null, null, false),
  ('Hedda_Nilsson', 4812524, 271, now() - interval '21 hours', '/avatars/69.webp', null, null, true),
  ('AndersLindqvist91', 4782758, 270, now() - interval '435 hours', '/avatars/62.webp', null, null, true),
  ('LaylaHaddad', 4761138, 235, now() - interval '159 hours', '/avatars/44.webp', null, null, true),
  ('Jiho_Nakamura', 4629846, 252, now() - interval '97 hours', '/avatars/56.webp', null, null, false),
  ('Grace.Morgan', 4575501, 245, now() - interval '167 hours', '/avatars/65.webp', null, null, true),
  ('LenaKrueger', 4545831, 255, now() - interval '263 hours', '/avatars/49.webp', null, null, true),
  ('SeojinLee', 4482038, 250, now() - interval '140 hours', '/avatars/50.webp', null, null, false),
  ('MiaHoffmann', 4448757, 212, now() - interval '550 hours', '/avatars/77.webp', null, null, false),
  ('PixelAce11', 4379272, 217, now() - interval '542 hours', '/avatars/80.webp', null, null, true),
  ('BuseYilmaz', 4338379, 240, now() - interval '494 hours', '/avatars/59.webp', null, null, false),
  ('TendaiDiallo63', 4306370, 216, now() - interval '111 hours', '/avatars/68.webp', null, null, false),
  ('Ines.Dubois', 4272019, 229, now() - interval '449 hours', '/avatars/86.webp', null, null, true),
  ('FatimaAziz86', 4177540, 248, now() - interval '489 hours', '/avatars/81.webp', null, null, true),
  ('AdityaSharma12', 4114062, 253, now() - interval '193 hours', '/avatars/70.webp', null, null, false),
  ('Arman_Hutomo', 4030310, 204, now() - interval '227 hours', '/avatars/83.webp', null, null, false),
  ('PinComet', 4012206, 216, now() - interval '313 hours', '/avatars/85.webp', null, null, true),
  ('Ishaan.Reddy', 3977136, 226, now() - interval '12 hours', '/avatars/75.webp', null, null, true),
  ('MartinaGreco', 3921554, 231, now() - interval '427 hours', '/avatars/79.webp', null, null, false),
  ('Hunter_45', 3919324, 231, now() - interval '158 hours', '/avatars/64.webp', null, null, true),
  ('KeremDemir', 3912212, 202, now() - interval '510 hours', '/avatars/72.webp', null, null, false),
  ('Camila.Rojas', 3899473, 212, now() - interval '621 hours', '/avatars/98.webp', null, null, false),
  ('Fatoumata_Abara', 3882522, 227, now() - interval '646 hours', '/avatars/90.webp', null, null, false),
  ('HannahBlake', 3858721, 205, now() - interval '169 hours', '/avatars/87.webp', null, null, true),
  ('Ace_24', 3763870, 236, now() - interval '422 hours', '/avatars/76.webp', null, null, false),
  ('GeoRanger462', 3737770, 222, now() - interval '147 hours', '/avatars/99.webp', null, null, false),
  ('PixelMaverick505', 3735793, 204, now() - interval '97 hours', '/avatars/88.webp', null, null, true),
  ('FinnKrueger', 3733414, 206, now() - interval '404 hours', '/avatars/74.webp', null, null, false),
  ('Jiho.Tanaka', 3679242, 220, now() - interval '82 hours', '/avatars/71.webp', null, null, true),
  ('Alice_Lefevre', 3652730, 215, now() - interval '262 hours', '/avatars/60.webp', null, null, true),
  ('Drifter_59', 3635232, 229, now() - interval '770 hours', '/avatars/96.webp', null, null, false),
  ('AgnieszkaLewandowski', 3603184, 211, now() - interval '38 hours', '/avatars/82.webp', null, null, true),
  ('ChiaraBruno', 3576113, 199, now() - interval '126 hours', '/avatars/93.webp', null, null, true),
  ('ManonRousseau', 3531324, 229, now() - interval '344 hours', '/avatars/92.webp', null, null, false),
  ('DiyaChaudhary', 3529929, 219, now() - interval '551 hours', '/avatars/104.webp', null, null, false),
  ('NathanFaure', 3489241, 223, now() - interval '411 hours', '/avatars/101.webp', null, null, true),
  ('Chiara.Villa', 3453575, 204, now() - interval '307 hours', '/avatars/84.webp', null, null, true),
  ('Marina_Teixeira', 3298717, 210, now() - interval '298 hours', '/avatars/108.webp', null, null, false),
  ('HassanAziz4', 3212183, 172, now() - interval '429 hours', '/avatars/100.webp', null, null, true),
  ('AndreiBelova82', 3200512, 210, now() - interval '623 hours', '/avatars/97.webp', null, null, false),
  ('Aditya_Reddy', 3176750, 209, now() - interval '276 hours', '/avatars/111.webp', null, null, false),
  ('Wei.Kim', 3048159, 185, now() - interval '352 hours', '/avatars/94.webp', null, null, false),
  ('SeojinWong26', 3029389, 189, now() - interval '736 hours', '/avatars/95.webp', null, null, true),
  ('PaulaVargas', 2995191, 194, now() - interval '610 hours', '/avatars/89.webp', null, null, true),
  ('Felipe.Barros', 2939651, 181, now() - interval '494 hours', '/avatars/107.webp', null, null, true),
  ('PinHunter147', 2928656, 201, now() - interval '324 hours', '/avatars/109.webp', null, null, false),
  ('PaulHoffmann', 2856291, 184, now() - interval '797 hours', '/avatars/113.webp', null, null, true),
  ('AndreiPetrov', 2836458, 183, now() - interval '736 hours', '/avatars/91.webp', null, null, true),
  ('RohanReddy44', 2818564, 175, now() - interval '248 hours', '/avatars/112.webp', null, null, false),
  ('AdityaMehta', 2775780, 164, now() - interval '30 hours', '/avatars/116.webp', null, null, true),
  ('StreetEmber538', 2771069, 198, now() - interval '580 hours', '/avatars/110.webp', null, null, false),
  ('Paula_Rojas', 2630052, 163, now() - interval '103 hours', '/avatars/119.webp', null, null, false),
  ('Martina.Colombo', 2619481, 166, now() - interval '414 hours', '/avatars/105.webp', null, null, false),
  ('Martina_Ferrari', 2607288, 193, now() - interval '300 hours', '/avatars/106.webp', null, null, true),
  ('HanaWong53', 2596881, 185, now() - interval '646 hours', '/avatars/103.webp', null, null, false),
  ('Ahmed_Karam', 2594203, 170, now() - interval '431 hours', '/avatars/125.webp', null, null, true),
  ('WorldExplorer403', 2534007, 189, now() - interval '389 hours', '/avatars/117.webp', null, null, true),
  ('Sara.Saleh', 2483711, 163, now() - interval '812 hours', '/avatars/115.webp', null, null, false),
  ('KenjiTanaka', 2480184, 160, now() - interval '340 hours', '/avatars/120.webp', null, null, false),
  ('NiaDiallo80', 2458938, 165, now() - interval '370 hours', '/avatars/127.webp', null, null, false),
  ('ThiagoBarros', 2429436, 173, now() - interval '726 hours', '/avatars/128.webp', null, null, true),
  ('GlobeMaverick901', 2361892, 172, now() - interval '336 hours', '/avatars/102.webp', null, null, false),
  ('Wanderer_91', 2297666, 161, now() - interval '24 hours', '/avatars/123.webp', null, null, false),
  ('Amira_Aziz', 2289969, 149, now() - interval '663 hours', '/avatars/118.webp', null, null, false),
  ('AvaReed', 2232918, 147, now() - interval '848 hours', '/avatars/126.webp', null, null, true),
  ('Sofia_Solberg', 2230264, 155, now() - interval '727 hours', '/avatars/121.webp', null, null, false),
  ('ThiagoRibeiro', 2135537, 155, now() - interval '837 hours', '/avatars/124.webp', null, null, false),
  ('DmitriOrlova24', 2100158, 165, now() - interval '271 hours', '/avatars/122.webp', null, null, false),
  ('Giulia_Greco', 2077169, 153, now() - interval '917 hours', '/avatars/137.webp', null, null, false),
  ('Arman.Wijaya', 2053960, 141, now() - interval '97 hours', '/avatars/135.webp', null, null, false),
  ('DmitriMorozov', 2042185, 159, now() - interval '795 hours', '/avatars/114.webp', null, null, false),
  ('AdityaSantos', 2010738, 151, now() - interval '18 hours', '/avatars/134.webp', null, null, false),
  ('LenaFischer49', 1984547, 140, now() - interval '211 hours', '/avatars/132.webp', null, null, false),
  ('WiktorLewandowski', 1976917, 154, now() - interval '420 hours', '/avatars/130.webp', null, null, true),
  ('KacperWisniewski', 1859872, 137, now() - interval '575 hours', '/avatars/141.webp', null, null, false),
  ('AtlasRogue', 1806265, 153, now() - interval '374 hours', '/avatars/133.webp', null, null, false),
  ('GeoRanger', 1789792, 145, now() - interval '121 hours', '/avatars/129.webp', null, null, false),
  ('ArmanReyes', 1783622, 145, now() - interval '740 hours', '/avatars/131.webp', null, null, false),
  ('TobiasSchaefer33', 1726090, 144, now() - interval '699 hours', '/avatars/142.webp', null, null, false),
  ('Camille_Rousseau', 1725579, 130, now() - interval '6 hours', '/avatars/139.webp', null, null, true),
  ('RohanChaudhary', 1655103, 145, now() - interval '389 hours', '/avatars/140.webp', null, null, false),
  ('Siti.Wijaya', 1614622, 148, now() - interval '339 hours', '/avatars/136.webp', null, null, false),
  ('ManonChevalier', 1555469, 142, now() - interval '565 hours', '/avatars/144.webp', null, null, false),
  ('MinjunWatanabe', 1552696, 124, now() - interval '113 hours', '/avatars/143.webp', null, null, false),
  ('StreetScout915', 1549483, 144, now() - interval '817 hours', '/avatars/146.webp', null, null, true),
  ('AtlasEmber402', 1484470, 119, now() - interval '517 hours', '/avatars/148.webp', null, null, false),
  ('PinVoyager', 1430894, 119, now() - interval '1076 hours', '/avatars/150.webp', null, null, false),
  ('YukiWong16', 1411863, 126, now() - interval '241 hours', '/avatars/145.webp', null, null, true),
  ('CemKaya', 1403528, 131, now() - interval '332 hours', '/avatars/149.webp', null, null, false),
  ('Layla.Aziz', 1357131, 126, now() - interval '387 hours', '/avatars/138.webp', null, null, false),
  ('Vikram.Kapoor', 1332328, 108, now() - interval '406 hours', '/avatars/147.webp', null, null, false),
  ('KwameAbara', 1281431, 112, now() - interval '105 hours', '/avatars/154.webp', null, null, false),
  ('HanaPark', 1237204, 123, now() - interval '358 hours', '/avatars/151.webp', null, null, true),
  ('Tomasz.Kowalski', 1194440, 99, now() - interval '166 hours', '/avatars/152.webp', null, null, false),
  ('FernandaBarros', 1125611, 113, now() - interval '772 hours', '/avatars/153.webp', null, null, false),
  ('Jun.Cruz', 1091510, 102, now() - interval '130 hours', '/avatars/155.webp', null, null, false),
  ('NehaChaudhary', 1045306, 111, now() - interval '403 hours', '/avatars/159.webp', null, null, false),
  ('Isabella.Navarro', 951569, 94, now() - interval '868 hours', '/avatars/160.webp', null, null, false),
  ('PinEcho', 889085, 88, now() - interval '700 hours', '/avatars/158.webp', null, null, true),
  ('FatoumataMensah32', 869385, 90, now() - interval '335 hours', '/avatars/157.webp', null, null, true),
  ('WorldDrifter763', 843055, 97, now() - interval '81 hours', '/avatars/163.webp', null, null, false),
  ('TobiasKrueger', 834598, 90, now() - interval '912 hours', '/avatars/166.webp', null, null, false),
  ('MasonBlake96', 825854, 94, now() - interval '596 hours', '/avatars/156.webp', null, null, false),
  ('Nova_59', 795456, 86, now() - interval '234 hours', '/avatars/162.webp', null, null, false),
  ('Comet_48', 724877, 88, now() - interval '712 hours', '/avatars/165.webp', null, null, false),
  ('AtlasMaverick179', 721398, 85, now() - interval '233 hours', '/avatars/161.webp', null, null, false),
  ('JoaoTeixeira', 709208, 74, now() - interval '881 hours', '/avatars/167.webp', null, null, false),
  ('LingTanaka', 657582, 81, now() - interval '1075 hours', '/avatars/164.webp', null, null, false),
  ('Beatriz_Souza', 603445, 72, now() - interval '206 hours', '/avatars/171.webp', null, null, false),
  ('GiuliaRossi', 577379, 70, now() - interval '1156 hours', '/avatars/168.webp', null, null, false),
  ('SergeiPetrov', 515271, 63, now() - interval '412 hours', '/avatars/170.webp', null, null, false),
  ('BudiSantos', 494069, 70, now() - interval '843 hours', '/avatars/169.webp', null, null, false),
  ('AmaraMwangi', 468971, 57, now() - interval '229 hours', '/avatars/172.webp', null, null, false),
  ('Mehmet.Kaya', 388677, 50, now() - interval '1202 hours', '/avatars/174.webp', null, null, true),
  ('LarissaTeixeira', 350882, 51, now() - interval '580 hours', '/avatars/173.webp', null, null, true),
  ('AtlasMaverick', 326706, 46, now() - interval '108 hours', '/avatars/176.webp', null, null, false),
  ('MeiChen9', 276349, 46, now() - interval '865 hours', '/avatars/175.webp', null, null, false),
  ('AndreiSokolov', 251331, 40, now() - interval '797 hours', '/avatars/177.webp', null, null, false),
  ('RafaelSouza48', 230443, 34, now() - interval '551 hours', '/avatars/178.webp', null, null, false),
  ('FatimaMansour', 172889, 26, now() - interval '271 hours', '/avatars/179.webp', null, null, false),
  ('Ronin_34', 94263, 17, now() - interval '544 hours', '/avatars/180.webp', null, null, false)
on conflict (username) do update set
  total_score = excluded.total_score,
  games_played = excluded.games_played,
  last_played_at = excluded.last_played_at,
  avatar_url = excluded.avatar_url,
  is_premium = excluded.is_premium;
-- instagram_handle / facebook_handle are deliberately NOT in this SET list,
-- so re-running this file after editing them in the Table Editor never
-- wipes them out - only the columns this file actually generates get
-- refreshed.

drop function if exists public.get_leaderboard();

create or replace function public.get_leaderboard()
returns table (
  username text,
  total_score bigint,
  games_played bigint,
  last_played_at timestamptz,
  avatar_url text,
  instagram_handle text,
  facebook_handle text,
  is_premium boolean
)
language sql
security definer
set search_path = public
as $$
  with real_scores as (
    select
      coalesce(p.username, 'Anonymous') as username,
      sum(gs.total_score)::bigint as total_score,
      count(*)::bigint as games_played,
      max(gs.created_at) as last_played_at,
      p.avatar_url,
      case when p.show_social then p.instagram_handle else null end as instagram_handle,
      case when p.show_social then p.facebook_handle else null end as facebook_handle,
      coalesce(bool_or(s.status = 'active' and (s.expires_at is null or s.expires_at > now())), false) as is_premium
    from public.game_scores gs
    join public.profiles p on p.id = gs.user_id
    left join public.subscriptions s on s.user_id = gs.user_id
    group by p.username, p.avatar_url, p.show_social, p.instagram_handle, p.facebook_handle
  ),
  fake_scores as (
    select username, total_score, games_played, last_played_at, avatar_url, instagram_handle, facebook_handle, is_premium
    from public.fake_leaderboard_entries
  )
  select * from real_scores
  union all
  select * from fake_scores
  order by total_score desc
  limit 200;
$$;

grant execute on function public.get_leaderboard() to anon, authenticated;
