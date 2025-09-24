/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from '@google/genai';

// --- APPLICATION STATE ---
interface EnhancedImage {
  id: string;
  src: string;
  mimeType: string;
  originalSrc: string; // The original image it was generated from
}

type EnhancementType = 'fineDining' | 'branding' | 'qualityEnhance';

const state = {
  isLoggedIn: false,
  isLoading: false,
  enhancementType: 'fineDining' as EnhancementType,
  originalImage: null as string | null,
  referenceImage: null as string | null,
  allEnhancedImages: [] as EnhancedImage[], // Persistent gallery for the session
  currentEnhancedImage: null as EnhancedImage | null,
  error: null as string | null,
  loadingMessage: '' as string,
  isModalOpen: false,
  modalContent: {
    originalSrc: null as string | null,
    enhancedSrc: null as string | null,
  },
};

// --- INDEXEDDB HELPERS for robust image storage ---
const DB_NAME = 'YumshotDB';
const DB_VERSION = 1;
const STORE_NAME = 'gallery';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject("Error opening IndexedDB.");
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }
  return dbPromise;
}

async function addImageToDb(image: EnhancedImage): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(image);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getGalleryFromDb(): Promise<EnhancedImage[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearGalleryInDb(): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// --- MOCK BACKEND SERVICE ---
// This simulates a backend API. It now uses a hybrid storage approach:
// - localStorage for small data (user info, settings)
// - IndexedDB for large data (image gallery) to avoid quota errors.
const backendService = {
  // Simulate network delay
  _delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  async login(email: string, password: string): Promise<{ user: { email: string }, settings: { enhancementType: EnhancementType }, gallery: EnhancedImage[] }> {
    await this._delay(500);
    if (!email || !password) throw new Error("Email and password are required.");
    
    // Store small session info in localStorage
    const sessionInfo = {
        user: { email },
        settings: { enhancementType: 'fineDining' as EnhancementType },
    };
    localStorage.setItem('yumshot_session_info', JSON.stringify(sessionInfo));
    
    // Fetch potentially large gallery from IndexedDB
    const gallery = await getGalleryFromDb();

    return { ...sessionInfo, gallery };
  },

  async logout(): Promise<void> {
    await this._delay(200);
    localStorage.removeItem('yumshot_session_info');
    await clearGalleryInDb();
  },

  async getSession(): Promise<{ user: { email: string }, settings: { enhancementType: EnhancementType }, gallery: EnhancedImage[] } | null> {
    await this._delay(100);
    const sessionData = localStorage.getItem('yumshot_session_info');
    if (sessionData) {
      const sessionInfo = JSON.parse(sessionData);
      const gallery = await getGalleryFromDb();
      return { ...sessionInfo, gallery };
    }
    return null;
  },

  async addToGallery(image: EnhancedImage): Promise<EnhancedImage[]> {
    await this._delay(300);
    if (!localStorage.getItem('yumshot_session_info')) throw new Error("Not authenticated");
    
    await addImageToDb(image);
    return await getGalleryFromDb();
  },
  
  async updateSettings(settings: { enhancementType: EnhancementType }): Promise<{ enhancementType: EnhancementType }> {
    await this._delay(150);
    const sessionData = localStorage.getItem('yumshot_session_info');
    if (!sessionData) throw new Error("Not authenticated");

    const sessionInfo = JSON.parse(sessionData);
    sessionInfo.settings = { ...sessionInfo.settings, ...settings };
    localStorage.setItem('yumshot_session_info', JSON.stringify(sessionInfo));
    return sessionInfo.settings;
  }
};


// --- GEMINI SETUP ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModel = 'gemini-2.5-flash-image-preview';
const textModel = 'gemini-2.5-flash';

const PROMPT_CREATOR_PROMPT = `
you are professional prompt creator for nano banana google model and your task is to create prompt based on received image of a dish - catch nuances of light, camera angle, composition - general principles of shot style so it could be applied to enhance any other dish picture and make it similar style to refference, here is example of great image enhencment prompt, use it as inspiration for your own new prompt (don’t copy it):
Professional Food Photography Transformation Prompt EXAMPLE
Core Instructions

Transform this amateur food photo into a professional fine dining presentation with the following specifications:

Visual Style & Aesthetics

Photography Style: High-end restaurant quality, studio lighting
Background: Pure black backdrop for dramatic contrast
Lighting: Soft, directional lighting with subtle shadows to create depth
Composition: Clean, minimalist plating with intentional negative space

Plating & Presentation Standards

Plate: Clean white porcelain, perfectly round, restaurant-grade
Food Arrangement: Precise, geometric placement with artistic spacing
Garnish Style: Micro herbs, dots of vibrant sauces, architectural vegetable cuts
Portion Control: Restaurant-appropriate portions, not home-style serving sizes

Technical Photography Parameters

Focus: Razor-sharp focus on main protein elements
Depth of Field: Shallow DOF with subtle background blur
Color Temperature: Warm, natural tones (3200-4000K)
Contrast: High contrast between food and black background
Saturation: Enhanced but natural color vibrancy

Professional Touches

Surface: Matte black table surface, no reflections or distractions
Cleanliness: Spotless plate rim, no sauce drips or fingerprints
Styling: Each element purposefully placed, restaurant plating techniques
Scale: Proper fine dining proportions and white space utilization

Specific Enhancements

Object Removal: Completely eliminate any non-food items, people, or environmental distractions
Centering & Cropping: Perfect central positioning of the dish within the frame
Food Quality Boost: Transform any overcooked, undercooked, or unappetizing elements into peak culinary condition
Professional Styling: Convert casual home plating into sophisticated restaurant presentation
Visual Appeal: Make every component look irresistibly appetizing and Instagram-worthy
Lighting Upgrade: Replace harsh phone flash or poor indoor lighting with professional food photography setup
Composition Refinement: Transform cluttered or awkward angles into clean, intentional presentation

Critical Requirements:

Remove ALL non-food elements and people from the image
Center the dish perfectly in frame with proper cropping
Enhance food appearance to look absolutely delicious and professionally prepared
Maintain food authenticity while maximizing visual appeal

Output Goal: Magazine-quality food photography suitable for high-end restaurant marketing or culinary publication
`;

const ELEGANT_FINE_DINING_PROMPT = `
Professional Food Photography Transformation Prompt

Core Instructions

Transform this amateur food photo into a professional fine dining presentation with the following specifications:
Visual Style & Aesthetics

Photography Style: High-end restaurant quality, studio lighting
Background: Pure black backdrop for dramatic contrast
Lighting: Soft, directional lighting with subtle shadows to create depth
Composition: Clean, minimalist plating with intentional negative space
Plating & Presentation Standards

Plate: Clean white porcelain, perfectly round, restaurant-grade
Food Arrangement: Precise, geometric placement with artistic spacing
Garnish Style: Micro herbs, dots of vibrant sauces, architectural vegetable cuts
Portion Control: Restaurant-appropriate portions, not home-style serving sizes

Technical Photography Parameters

Focus: Razor-sharp focus on main protein elements
Depth of Field: Shallow DOF with subtle background blur
Color Temperature: Warm, natural tones (3200-4000K)
Contrast: High contrast between food and black background
Saturation: Enhanced but natural color vibrancy

Professional Touches

Surface: Matte black table surface, no reflections or distractions
Cleanliness: Spotless plate rim, no sauce drips or fingerprints
Styling: Each element purposefully placed, restaurant plating techniques
Scale: Proper fine dining proportions and white space utilization

Specific Enhancements

Object Removal: Completely eliminate any non-food items, people, or environmental distractions
Centering & Cropping: Perfect central positioning of the dish within the frame
Food Quality Boost: Transform any overcooked, undercooked, or unappetizing elements into peak culinary condition
Professional Styling: Convert casual home plating into sophisticated restaurant presentation
Visual Appeal: Make every component look irresistibly appetizing and Instagram-worthy
Lighting Upgrade: Replace harsh phone flash or poor indoor lighting with professional food photography setup
Composition Refinement: Transform cluttered or awkward angles into clean, intentional presentation

Critical Requirements:

Remove ALL non-food elements and people from the image
Center the dish perfectly in frame with proper cropping
Enhance food appearance to look absolutely delicious and professionally prepared
Maintain food authenticity while maximizing visual appeal

Output Goal: Magazine-quality food photography suitable for high-end restaurant marketing or culinary publication.
`;

const QUALITY_ENHANCE_PROMPT = `
### Universal Food Image Color Correction

This prompt is designed to apply a **universal color and lighting correction** to a variety of food images. The goal is to enhance the photo's natural colors and improve lighting without altering the composition, plating, or other details of the original shot.

---

**Core Instructions**
* **Enhance Lighting:** Improve overall brightness and exposure to make the food look more vibrant and appealing.
* **Correct Color Balance:** Adjust the white balance to remove any unwanted color casts (e.g., yellow from indoor lighting, blue from flash) and achieve a neutral, natural look.
* **Boost Natural Vibrancy:** Increase the saturation and vibrance of the food's colors to make them pop, but keep them looking realistic and appetizing.
* **Improve Contrast:** Gently increase contrast to add depth and make textures stand out without creating harsh shadows or highlights.

**Key Parameters**
* **Lighting:** Add a soft, warm glow to the food. Eliminate harsh shadows or overexposed areas. The final image should look as if it was taken in a well-lit, natural environment.
* **Color:** The colors of the food should be true to life—crisp greens, rich reds, and golden browns should be accurately represented.
* **Sharpness:** Ensure the focus remains sharp on the main elements of the dish.
* **Composition:** **Do not alter the cropping, angle, or any elements of the original image.** The only changes should be to the color and light.

**Output Goal**
* The final image should look like a professionally corrected photograph, with enhanced lighting and natural, appealing colors.
* The adjustments should be subtle enough to feel authentic and not overly processed.
`;

const LOADING_MESSAGES = [
    "Plating your dish...",
    "Adjusting the lighting...",
    "Adding a touch of Michelin magic...",
    "Consulting with our virtual chef...",
    "Perfecting the presentation...",
];

// --- UI RENDERING ---
const appContainer = document.getElementById('app-container');

function createUploadArea(type: 'original' | 'reference', imageSrc: string | null) {
  const titles = {
    original: '1. Your Dish Photo',
    reference: '1. Reference Style'
  };
   const descriptions = {
    original: 'Upload an image of your dish to get started.',
    reference: 'Upload an image with the style you want to match.'
  };

  return `
    <div>
      <h2 class="text-2xl font-semibold mb-1">${titles[type]}</h2>
      <p class="text-gray-400 mb-4">${descriptions[type]}</p>
      <div id="image-upload-area-${type}" class="relative border-2 border-dashed border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-yellow-400 transition-colors">
        <input type="file" id="image-upload-input-${type}" data-upload-type="${type}" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept="image/png, image/jpeg, image/webp">
        ${imageSrc 
          ? `<img src="${imageSrc}" alt="${type} image" class="max-h-60 mx-auto rounded-md object-contain">
             <button data-clear-type="${type}" class="clear-image-btn absolute top-2 right-2 bg-gray-900/50 text-white rounded-full p-1 hover:bg-gray-700 transition-colors" aria-label="Clear image">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
             </button>
            `
          : `<div class="flex flex-col items-center justify-center space-y-2 text-gray-400">
              <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
              <p>Click to upload or drag & drop</p>
              <p class="text-xs">PNG, JPG, WEBP</p>
            </div>`
        }
      </div>
    </div>
  `;
}

function render() {
  if (!appContainer) return;
  
  const isEnhanceDisabled = state.isLoading || !state.originalImage || (state.enhancementType === 'branding' && !state.referenceImage);
    
  const modalHTML = state.isModalOpen ? `
    <div id="gallery-modal-overlay" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-5xl p-4 md:p-6 relative transform transition-all scale-95 animate-scale-in">
        <button id="modal-close-btn" class="absolute -top-4 -right-4 bg-yellow-400 text-gray-900 rounded-full p-2 hover:bg-yellow-300 focus:outline-none focus:ring-2 focus:ring-white z-10" aria-label="Close viewer">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div>
            <h3 class="text-lg font-semibold text-gray-300 mb-2 text-center">Original</h3>
            <img src="${state.modalContent.originalSrc}" alt="Original image" class="rounded-lg object-contain w-full max-h-[75vh]">
          </div>
          <div>
            <h3 class="text-lg font-semibold text-yellow-400 mb-2 text-center">Enhanced</h3>
            <img src="${state.modalContent.enhancedSrc}" alt="Enhanced image" class="rounded-lg object-contain w-full max-h-[75vh]">
          </div>
        </div>
      </div>
    </div>
  ` : '';

  if (!state.isLoggedIn) {
    appContainer.innerHTML = `
      <div class="flex items-center justify-center min-h-screen bg-gray-900">
        <div class="w-full max-w-md p-8 space-y-8 bg-gray-800 rounded-2xl shadow-lg">
          <div class="text-center">
            <h1 class="text-4xl font-bold text-yellow-400">YumShot</h1>
            <p class="mt-2 text-gray-400">Transform your food photos into masterpieces.</p>
          </div>
          <form id="login-form" class="space-y-6">
            <div>
              <label for="email" class="text-sm font-medium text-gray-300 sr-only">Email</label>
              <input type="email" id="email" placeholder="Email address" class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-yellow-400 focus:border-yellow-400" required value="user@example.com">
            </div>
            <div>
              <label for="password" class="text-sm font-medium text-gray-300 sr-only">Password</label>
              <input type="password" id="password" placeholder="Password" class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-yellow-400 focus:border-yellow-400" required value="password">
            </div>
            <button type="submit" class="w-full px-4 py-3 font-bold text-gray-900 bg-yellow-400 rounded-lg hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-yellow-400 transition-all duration-300 disabled:bg-gray-500" ${state.isLoading ? 'disabled' : ''}>
              ${state.isLoading ? 'Signing In...' : 'Sign In / Sign Up'}
            </button>
             ${state.error ? `<p class="text-sm text-red-400 text-center mt-2">${state.error}</p>` : ''}
          </form>
        </div>
      </div>
    `;
  } else {
    appContainer.innerHTML = `
      <div class="flex flex-col min-h-screen">
        <header class="bg-gray-800/50 backdrop-blur-sm shadow-lg sticky top-0 z-10">
          <nav class="container mx-auto px-6 py-4 flex justify-between items-center">
            <h1 class="text-2xl font-bold text-yellow-400">YumShot</h1>
            <button id="logout-btn" class="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors">Logout</button>
          </nav>
        </header>

        <main class="flex-grow container mx-auto p-4 md:p-8">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <!-- Left Column: Upload & Controls -->
            <div class="bg-gray-800 p-6 rounded-xl shadow-2xl flex flex-col space-y-6">
              <div>
                 <h2 class="text-2xl font-semibold mb-1">Enhancement Type</h2>
                 <div id="enhancement-type-selector" class="grid grid-cols-3 gap-2 mt-2 rounded-lg bg-gray-700 p-1">
                    <button data-type="qualityEnhance" class="enhancement-type-btn ${state.enhancementType === 'qualityEnhance' ? 'bg-yellow-400 text-gray-900' : 'text-gray-300 hover:bg-gray-600'} rounded-md py-2 text-sm font-bold transition-colors">Quality Enhance</button>
                    <button data-type="fineDining" class="enhancement-type-btn ${state.enhancementType === 'fineDining' ? 'bg-yellow-400 text-gray-900' : 'text-gray-300 hover:bg-gray-600'} rounded-md py-2 text-sm font-bold transition-colors">Fine Dining</button>
                    <button data-type="branding" class="enhancement-type-btn ${state.enhancementType === 'branding' ? 'bg-yellow-400 text-gray-900' : 'text-gray-300 hover:bg-gray-600'} rounded-md py-2 text-sm font-bold transition-colors">Branding</button>
                 </div>
                 ${state.enhancementType === 'branding' ? `<p class="text-xs text-gray-400 mt-2">Please upload images of dishes in the photography style you like, and we’ll use them as a reference when editing your photos.</p>` : ''}
              </div>

              ${state.enhancementType === 'branding' ? createUploadArea('reference', state.referenceImage) : ''}
              ${createUploadArea('original', state.originalImage)}
              
               <button id="enhance-btn" class="w-full py-4 text-lg font-bold text-gray-900 bg-yellow-400 rounded-lg hover:bg-yellow-500 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed" ${isEnhanceDisabled ? 'disabled' : ''}>
                ${state.isLoading ? 'Enhancing...' : 'Enhance Photo'}
              </button>
            </div>
            
            <!-- Right Column: Result -->
            <div class="bg-gray-800 p-6 rounded-xl shadow-2xl flex flex-col justify-start items-center text-center">
              <h2 class="text-2xl font-semibold mb-4 self-start">AI Enhanced Result</h2>
              <div class="w-full flex-grow flex flex-col justify-center items-center">
                ${state.isLoading 
                  ? `<div class="flex flex-col items-center space-y-4">
                      <div class="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-yellow-400"></div>
                      <p id="loading-message" class="text-gray-300">${state.loadingMessage}</p>
                    </div>`
                  : state.currentEnhancedImage 
                  ? `<div class="w-full flex flex-col items-center">
                      <img src="${state.currentEnhancedImage.src}" alt="Enhanced dish" class="max-h-[28rem] w-auto mx-auto rounded-md object-contain">
                      <div class="flex items-center justify-center gap-4 mt-6 w-full max-w-sm mx-auto">
                        <button id="save-btn" class="flex-1 py-3 text-lg font-bold text-gray-900 bg-green-500 rounded-lg hover:bg-green-600 transition-all duration-300">Save Image</button>
                        <button id="try-again-btn" class="flex-1 py-3 text-lg font-bold text-yellow-400 bg-gray-700 rounded-lg hover:bg-gray-600 transition-all duration-300">Try Again</button>
                      </div>
                    </div>`
                  : state.error 
                  ? `<div class="text-red-400 p-4 border border-red-500 bg-red-900/20 rounded-lg">
                      <h3 class="font-bold">An Error Occurred</h3>
                      <p>${state.error}</p>
                    </div>`
                  : `<div class="text-gray-500">
                      <svg class="w-24 h-24 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
                      <p class="mt-2">Your enhanced image will appear here.</p>
                    </div>`
                }
              </div>
              ${state.allEnhancedImages.length > 0 ? `
                <div class="w-full mt-6 pt-6 border-t border-gray-700">
                  <h3 class="text-lg font-semibold mb-3 text-left">Gallery</h3>
                  <div id="gallery-container" class="flex gap-3 pb-3 -mx-6 px-6 overflow-x-auto">
                    ${[...state.allEnhancedImages].reverse().map(img => `
                      <img
                        src="${img.src}"
                        alt="Enhanced thumbnail"
                        class="w-20 h-20 object-cover rounded-md cursor-pointer border-2 ${state.currentEnhancedImage?.id === img.id ? 'border-yellow-400' : 'border-transparent hover:border-gray-500'}"
                        data-id="${img.id}"
                      >
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        </main>
      </div>
      ${modalHTML}
    `;
  }
  
  attachEventListeners();
}

// --- EVENT LISTENERS ---
function attachEventListeners() {
  // Auth
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  // Enhancement Type
  document.getElementById('enhancement-type-selector')?.addEventListener('click', handleEnhancementTypeChange);

  // Image Upload
  ['original', 'reference'].forEach(type => {
      const uploadArea = document.getElementById(`image-upload-area-${type}`);
      const uploadInput = document.getElementById(`image-upload-input-${type}`) as HTMLInputElement;
      if (uploadArea && uploadInput) {
          uploadArea.addEventListener('click', () => uploadInput.click());
          uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).classList.add('border-yellow-400'); });
          uploadArea.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).classList.remove('border-yellow-400'); });
          uploadArea.addEventListener('drop', handleImageDrop);
          uploadInput.addEventListener('change', handleImageSelect);
      }
  });
  
  // Actions
  document.getElementById('enhance-btn')?.addEventListener('click', handleEnhance);
  document.getElementById('save-btn')?.addEventListener('click', handleSave);
  document.getElementById('try-again-btn')?.addEventListener('click', handleEnhance);
  document.querySelectorAll('.clear-image-btn').forEach(btn => btn.addEventListener('click', handleClearImage));
  
  // Gallery & Modal
  document.getElementById('gallery-container')?.addEventListener('click', handleGalleryClick);
  document.getElementById('modal-close-btn')?.addEventListener('click', handleCloseModal);
  document.getElementById('gallery-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        handleCloseModal();
    }
  });
}


// --- HANDLERS ---
async function handleLogin(e: Event) {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  if (state.isLoading) return;

  state.isLoading = true;
  state.error = null;
  render();

  const emailInput = document.getElementById('email') as HTMLInputElement;
  const passwordInput = document.getElementById('password') as HTMLInputElement;

  try {
      const session = await backendService.login(emailInput.value, passwordInput.value);
      state.isLoggedIn = true;
      state.enhancementType = session.settings.enhancementType;
      state.allEnhancedImages = session.gallery;
      if (session.gallery.length > 0) {
        state.currentEnhancedImage = session.gallery[session.gallery.length - 1];
      }
  } catch (err: any) {
      state.error = err.message || "Failed to log in.";
  } finally {
      state.isLoading = false;
      render();
  }
}

async function handleLogout() {
    await backendService.logout();
    // Reset entire state on logout
    state.isLoggedIn = false;
    state.isLoading = false;
    state.originalImage = null;
    state.referenceImage = null;
    state.allEnhancedImages = [];
    state.currentEnhancedImage = null;
    state.error = null;
    state.isModalOpen = false;
    state.modalContent = { originalSrc: null, enhancedSrc: null };
    render();
}

async function handleEnhancementTypeChange(e: Event) {
    const target = e.target as HTMLElement;
    const type = target.dataset.type as EnhancementType;
    if (type && type !== state.enhancementType) {
        state.enhancementType = type;
        // Reset images when changing mode to avoid confusion
        state.originalImage = null;
        state.referenceImage = null;
        state.currentEnhancedImage = null;
        state.error = null;
        render(); // Optimistic UI update

        try {
            await backendService.updateSettings({ enhancementType: type });
        } catch (err) {
            console.error("Failed to save settings:", err);
            // Optionally, revert the change and show an error message to the user
        }
    }
}

function handleImageDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  const targetElement = e.currentTarget as HTMLElement;
  targetElement.classList.remove('border-yellow-400');
  const uploadType = (targetElement.querySelector('input') as HTMLInputElement)?.dataset.uploadType as 'original' | 'reference';
  
  if (uploadType && e.dataTransfer?.files?.[0]) {
    processFile(e.dataTransfer.files[0], uploadType);
  }
}

function handleImageSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const uploadType = target.dataset.uploadType as 'original' | 'reference';
  if (uploadType && target.files?.[0]) {
    processFile(target.files[0], uploadType);
  }
}

function handleClearImage(e: Event) {
    e.stopPropagation(); // prevent triggering the file input
    const target = e.currentTarget as HTMLElement;
    const clearType = target.dataset.clearType as 'original' | 'reference';
    if (clearType) {
        state[clearType === 'original' ? 'originalImage' : 'referenceImage'] = null;
        state.currentEnhancedImage = null;
        state.error = null;
        const uploadInput = document.getElementById(`image-upload-input-${clearType}`) as HTMLInputElement;
        if (uploadInput) uploadInput.value = '';
        render();
    }
}

function processFile(file: File, type: 'original' | 'reference') {
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target?.result as string;
    if (type === 'original') {
        state.originalImage = result;
    } else {
        state.referenceImage = result;
    }
    state.currentEnhancedImage = null;
    state.error = null;
    render();
  };
  reader.readAsDataURL(file);
}

async function handleEnhance() {
  if (state.isLoading) return;

  const originalImageForEnhancement = state.currentEnhancedImage?.originalSrc || state.originalImage;
      
  if (!originalImageForEnhancement) return;

  state.isLoading = true;
  state.error = null;
  render();

  try {
    let enhancementPrompt = '';
    
    // Step 1: Select or generate the prompt
    if (state.enhancementType === 'fineDining') {
        enhancementPrompt = ELEGANT_FINE_DINING_PROMPT;
    } else if (state.enhancementType === 'qualityEnhance') {
        enhancementPrompt = QUALITY_ENHANCE_PROMPT;
    } else if (state.enhancementType === 'branding') {
        if (!state.referenceImage) throw new Error("Reference image is missing.");
        state.loadingMessage = "Analyzing reference style...";
        render();
        
        const refPart = dataUrlToPart(state.referenceImage);
        const promptGenResponse = await ai.models.generateContent({
            model: textModel,
            contents: { parts: [{ inlineData: refPart }, { text: PROMPT_CREATOR_PROMPT }] },
        });

        enhancementPrompt = promptGenResponse.text;
        if (!enhancementPrompt) {
            throw new Error("Could not generate a style prompt from the reference image.");
        }
    }

    if (!enhancementPrompt) {
      throw new Error("Enhancement prompt could not be determined.");
    }

    // Step 2: Enhance the dish image
    state.loadingMessage = "Applying style to your dish...";
    const loadingMessageElement = document.getElementById('loading-message');
    let messageInterval: number | undefined;

    if (loadingMessageElement) {
        let i = 0;
        state.loadingMessage = LOADING_MESSAGES[i];
        messageInterval = window.setInterval(() => {
            i = (i + 1) % LOADING_MESSAGES.length;
            if(state.isLoading) {
                loadingMessageElement.textContent = LOADING_MESSAGES[i];
            } else {
                clearInterval(messageInterval);
            }
        }, 2500);
    }
    render();

    const { data, mimeType } = dataUrlToPart(originalImageForEnhancement);

    const response = await ai.models.generateContent({
      model: imageModel,
      contents: {
        parts: [
          { inlineData: { data, mimeType } },
          { text: enhancementPrompt },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });
    
    if (messageInterval) clearInterval(messageInterval);

    const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
      const newImage: EnhancedImage = {
        id: Date.now().toString(),
        src: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
        mimeType: imagePart.inlineData.mimeType,
        originalSrc: originalImageForEnhancement,
      };
      // Save to backend and update local state from response
      const updatedGallery = await backendService.addToGallery(newImage);
      state.allEnhancedImages = updatedGallery;
      state.currentEnhancedImage = newImage;
    } else {
      throw new Error("The AI did not return an image. Please try a different photo or try again.");
    }
  } catch (err: any) {
    console.error("Gemini API Error:", err);
    state.error = err.message || "An unknown error occurred while enhancing the image.";
    state.currentEnhancedImage = null;
  } finally {
    state.isLoading = false;
    state.loadingMessage = '';
    render();
  }
}

function handleSave() {
  if (!state.currentEnhancedImage) return;
  const link = document.createElement('a');
  link.href = state.currentEnhancedImage.src;
  const fileExtension = state.currentEnhancedImage.mimeType.split('/')[1] || 'jpeg';
  link.download = `yumshot-enhanced-${Date.now()}.${fileExtension}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function handleGalleryClick(e: Event) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' && target.dataset.id) {
        const imageId = target.dataset.id;
        const selectedImage = state.allEnhancedImages.find(img => img.id === imageId);
        if (selectedImage) {
            state.currentEnhancedImage = selectedImage; // Also set as current
            state.modalContent = {
                originalSrc: selectedImage.originalSrc,
                enhancedSrc: selectedImage.src,
            };
            state.isModalOpen = true;
            render();
        }
    }
}

function handleCloseModal() {
    state.isModalOpen = false;
    state.modalContent = { originalSrc: null, enhancedSrc: null };
    render();
}

// --- UTILITIES ---
function dataUrlToPart(dataUrl: string): { data: string, mimeType: string } {
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    return { data: base64, mimeType };
}


// --- INITIALIZATION ---
async function initializeApp() {
    try {
        const session = await backendService.getSession();
        if (session) {
            state.isLoggedIn = true;
            state.enhancementType = session.settings.enhancementType;
            state.allEnhancedImages = session.gallery;
            if (session.gallery.length > 0) {
                // Set the last image as the current one
                state.currentEnhancedImage = session.gallery[session.gallery.length - 1];
            }
        }
    } catch (error) {
        console.error("Could not load session data:", error);
        state.error = 'Could not load your session. Please try logging in again.';
    } finally {
        render();
    }
}

initializeApp();
