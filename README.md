# Test - Agenda mobile de cours

Application mobile Expo (React Native + TypeScript) pour gérer un agenda hebdomadaire du **lundi au vendredi**.

## Fonctionnalités implémentées

- Agenda hebdomadaire structuré du lundi au vendredi.
- Création d'évènements de cours (jour, nom du cours, heure de début/fin).
- Option de proposition d'enregistrement audio à la création d'évènement.
- Option **mode micro éteint** (simulé) pour produire un audio estimé plus léger.
- Génération locale (simulée) des sorties suivantes par évènement :
  - fichier audio léger (métadonnées),
  - retranscription textuelle,
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
2. Activer/désactiver l'option audio.
3. Activer le mode micro éteint.
4. Vérifier l'affichage des blocs : audio, transcription, synthèse, image.
