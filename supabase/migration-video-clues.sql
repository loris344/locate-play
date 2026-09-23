-- Indices visuels affichés à la fin d'une manche (écran de révélation, façon GeoGuessr).
-- Produits par pipeline/ (Gemini localise chaque indice dans une image ; scripts/add-video.mjs envoie les
-- images sur R2 et remplit cette colonne).
-- Format : [{ "text": "Panneau de rue en hongrois", "t": 63.0,
--             "crop_url": "https://…/carolina47-clue-1.jpg", "frame_url": "https://…/carolina47-clue-1-frame.jpg",
--             "box": [ymin, xmin, ymax, xmax] }]   (box en 0-1, relative à frame_url)
-- Sûr à relancer. À appliquer dans le SQL Editor de Supabase.
-- Les indices ne sont renvoyés au client que par la fonction submit-round, après la réponse du joueur.

alter table public.videos add column if not exists clues jsonb;
