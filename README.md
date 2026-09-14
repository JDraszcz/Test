# Test - Agenda mobile de cours

Application mobile Expo (React Native + TypeScript) pour gérer un agenda hebdomadaire du **lundi au vendredi**.

## Fonctionnalités implémentées

- Agenda hebdomadaire structuré du lundi au vendredi.
- Création d'évènements de cours (jour, nom du cours, heure de début/fin).
- Création d'un cours depuis un bouton flottant, avec horaires par tranches de 30 minutes.
- Catégories réutilisables et conservées localement pour relier les cours entre eux.
- Tags de cours sous forme de pastilles, ajoutés avec la touche Entrée comme dans Notion.
- Agenda compact : chaque cours ouvre une fiche détaillée avec lecteur audio et action de transcription.
- Captation audio réelle dans les navigateurs compatibles, avec arrêt manuel ou à l'heure de fin.
- Sorties par évènement :
  - fichier audio capturé dans le navigateur (WebM),
  - étape de retranscription après l'arrêt (le moteur distant de retranscription reste à connecter),
  - synthèse du cours,
  - concept d'image liée au cours.

## Tester l'application dans Visual Studio Code

### 1) Pré-requis

- Node.js 20+
- Visual Studio Code
- Extension recommandée : **Expo Tools** (facultatif)

### 2) Installation

```bash
npm install
```

### 3) Lancer l'app

```bash
npm run web
```

Puis ouvrir l'URL locale affichée dans le terminal (ex: `http://localhost:8081`).

Alternative mobile réelle :

```bash
npm run start
```

et scanner le QR code avec l'application **Expo Go**.

### 4) Vérification rapide

1. Ajouter un cours sur un jour (lundi-vendredi).
2. Cliquer sur le bouton flottant « + ».
3. Renseigner le cours, les catégories et sélectionner les horaires.
4. Cliquer sur « Démarrer la prise de notes audio » et autoriser l'accès au microphone.
5. Arrêter depuis la carte du cours, puis vérifier le passage par l'étape de retranscription.

### 5) Préparation de l'intégration Notion

L'écran **Notion** demande une connexion lors de la première visite, puis permet d'exporter tous les cours. Le payload est défini dans `notion.ts` avec les propriétés `Name`, `Jour`, `Horaire` et `Tags`.

Pour activer l'envoi réel :

1. Créer une intégration Notion et partager la base cible avec cette intégration.
2. Copier `.env.example` vers `.env` et renseigner les identifiants Notion.
3. Démarrer le backend avec `npm run backend`.
4. Configurer dans Notion l'URL de redirection `http://localhost:8787/api/notion/oauth/callback`.
5. Lancer Expo avec `npm run web`, puis cliquer sur **Se connecter à Notion**.
6. Le backend échange le code OAuth contre un token, le garde dans une session HttpOnly, puis redirige vers `testmobile://notion/callback?notion_connected=true`.
7. Le bouton **Exporter tous les cours** envoie chaque cours à `https://api.notion.com/v1/pages`.

Le client ne reçoit jamais le token Notion. L'export reste bloqué tant que le callback OAuth n'a pas confirmé la connexion.
