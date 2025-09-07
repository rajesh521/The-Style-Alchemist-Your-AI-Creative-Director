/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality, Part } from "@google/genai";

// Gracefully handle API key initialization.
let ai: GoogleGenAI | null = null;
let apiKeyError: string | null = null;

try {
    // This will throw an error if process.env.API_KEY is not available.
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
} catch (e) {
    console.error("API Key is missing or invalid. The application will not be able to generate images. Please ensure the API_KEY environment variable is set correctly for your deployment environment.", e);
    apiKeyError = "The AI Alchemist is not configured correctly. Please contact the administrator to resolve this issue.";
}


// --- Helper Functions ---
const fileToGenerativePart = async (file: File): Promise<Part> => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: {
            data: await base64EncodedDataPromise,
            mimeType: file.type,
        },
    };
};

// --- System Prompts ---
const MODEL_SHOT_SYSTEM_PROMPT = `
## ROLE & MISSION ##
You are a world-class AI Creative Director known as "The Alchemist." Your purpose is to generate stunning lookbook photographs by interpreting creative direction from multiple sources.

## ZERO-TOLERANCE POLICY ON CONTENT COPYING ##
THIS IS THE MOST IMPORTANT RULE. FAILURE TO FOLLOW IT IS A COMPLETE FAILURE OF THE TASK.

- The image provided as 'AESTHETIC INSPIRATION PHOTO' is for STYLE, MOOD, AND LIGHTING ONLY.
- It is ABSOLUTELY PROHIBITED to copy, replicate, transfer, or be inspired by any PEOPLE, FACES, or specific identifiable OBJECTS from the 'AESTHETIC INSPIRATION PHOTO'.
- The generated human model MUST BE A COMPLETELY NEW, UNIQUE, AND ARTIFICIALLY GENERATED PERSON. They must not look like the person in the inspiration photo. Any resemblance is a failure.

## HIERARCHY OF CREATIVE DIRECTION ##
You will be given multiple inputs. You MUST process them in this order of priority:

1.  **HERO ITEM PHOTO:** This is the product to be featured. It is sacred.
    -   **Hero Item Integrity:** You MUST NOT alter the item's fundamental shape, type, or design. A t-shirt must remain a t-shirt. Preserve its original form factor perfectly.
    -   The item MUST be extracted perfectly and placed realistically on the generated model.
    -   The lighting on the Hero Item MUST match the final scene's lighting.

2.  **CREATIVE BRIEF (Text Prompt):** If provided, this text dictates the **subject and setting** of the scene (e.g., "a model in a moody, dark library"). This overrides any subject/setting from the inspiration photo.

3.  **AESTHETIC INSPIRATION PHOTO:** Use this **ONLY** as an 'Aesthetic Filter' for the final image's *feel*.
    -   **IF a Creative Brief exists:** Apply the inspiration photo's color palette, lighting, mood, and photographic genre to the scene described in the text prompt. For example, if the inspiration is a sunny beach, but the prompt is "dark library," you MUST generate a dark library that has the *warm light quality and color grading* of the beach photo. **DO NOT generate a beach.**
    -   **IF NO Creative Brief exists:** You may use the general setting from the inspiration photo (e.g., a forest, a city street) but you still MUST NOT copy any people, faces, or specific objects from it.

## FINAL OUTPUT ##
-   The output must be a single, hyper-realistic, professional-quality photograph.
-   The generated model should have a consistent and realistic appearance, like a professional fashion model.
`;

const PRODUCT_SHOT_SYSTEM_PROMPT = `
## ROLE & MISSION ##
You are a world-class AI Creative Director known as "The Alchemist." Your purpose is to generate stunning product photographs.

## CORE DIRECTIVE: PRODUCT SHOT ##
- You MUST generate a 'product shot' or 'still life' photograph.
- CRITICAL: DO NOT generate any human model, person, hand, or any body part. The image must be completely devoid of people.
- The 'HERO ITEM PHOTO' must be the sole focus, placed in an elegant and appropriate setting that complements its style.

## HIERARCHY OF CREATIVE DIRECTION ##
1.  **HERO ITEM PHOTO:** This is the product to be featured. It is sacred. Preserve its original form factor perfectly. The lighting on the Hero Item MUST match the final scene's lighting.
2.  **AESTHETIC INSPIRATION PHOTO:** Use this ONLY as an 'Aesthetic Filter' for the final image's feel (color palette, lighting, mood, photographic genre). DO NOT copy any objects from it.
3.  **CREATIVE BRIEF (Text Prompt):** If provided, this text dictates the setting for the product (e.g., "placed on a rustic wooden table" or "on a silk cloth").

## FINAL OUTPUT ##
- The output must be a single, hyper-realistic, professional-quality photograph of the product.
`;


// --- Components ---

interface ImageUploaderProps {
    onFileSelect: (file: File) => void;
    selectedFile: File | null;
    onFileRemove: () => void;
    title: string;
    description: string;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onFileSelect, selectedFile, onFileRemove, title, description }) => {
    const [preview, setPreview] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedFile) {
            setPreview(null);
            return;
        }
        const objectUrl = URL.createObjectURL(selectedFile);
        setPreview(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [selectedFile]);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    }, [onFileSelect]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
        }
    };

    return (
        <div className="input-group">
            <label>{title}</label>
            <p style={{marginTop: '-4px', marginBottom: '12px'}}><span>{description}</span></p>
            {!preview ? (
                 <div
                    className="drop-zone"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById(title)?.click()}
                >
                    <input type="file" id={title} accept="image/*" onChange={handleChange} hidden/>
                    <p>Drag & drop image here, or click to select</p>
                </div>
            ) : (
                <div className="image-preview">
                    <img src={preview} alt="Preview" />
                    <button className="remove-btn" onClick={onFileRemove} aria-label="Remove image">
                        &times;
                    </button>
                </div>
            )}
        </div>
    );
};


const App: React.FC = () => {
    const [heroItem, setHeroItem] = useState<File | null>(null);
    const [inspirationPhoto, setInspirationPhoto] = useState<File | null>(null);
    const [stylePrompt, setStylePrompt] = useState<string>('');
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [itemCategory, setItemCategory] = useState<string | null>(null);
    const [isIdentifying, setIsIdentifying] = useState<boolean>(false);
    const [isDownloadMenuOpen, setDownloadMenuOpen] = useState(false);
    const [shotType, setShotType] = useState<'model' | 'product'>('model');

    const accessoryCategories = ['Watch', 'Bracelet', 'Ring', 'Necklace', 'Earrings', 'Handbag'];

    // Identify Item Category when Hero Item is uploaded
    useEffect(() => {
        const identifyItemCategory = async (file: File) => {
            if (!ai) {
                setError(apiKeyError);
                return;
            }
            setIsIdentifying(true);
            setItemCategory(null);
            setShotType('model'); // Reset shot type on new item
            try {
                const imagePart = await fileToGenerativePart(file);
                const prompt = `Analyze the image and identify the primary clothing or accessory item. Respond with ONLY one of the following categories that best fits the item: T-Shirt, Top, Jacket, Pants, Dress, Watch, Bracelet, Ring, Necklace, Earrings, Hat, Shoes, Handbag. If it doesn't fit, respond with 'Other'.`;
                
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [{text: prompt}, imagePart] },
                });
    
                const category = response.text.trim();
                setItemCategory(category);
    
            } catch (err) {
                console.error("Error identifying item:", err);
                setItemCategory('Other'); // Fail gracefully
            } finally {
                setIsIdentifying(false);
            }
        };

        if (heroItem) {
            identifyItemCategory(heroItem);
        } else {
            setItemCategory(null);
        }
    }, [heroItem]);


    const handleGenerate = async () => {
        if (!ai) {
            setError(apiKeyError);
            setIsLoading(false);
            return;
        }
        if (!heroItem) return;

        setIsLoading(true);
        setError(null);

        try {
            const parts: Part[] = [];
            const isProductShot = shotType === 'product' && itemCategory && accessoryCategories.includes(itemCategory);
            let activeSystemPrompt = isProductShot ? PRODUCT_SHOT_SYSTEM_PROMPT : MODEL_SHOT_SYSTEM_PROMPT;

            if (generatedImage) {
                 const getImageDimensions = (src: string): Promise<{ width: number; height: number }> =>
                    new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
                        img.onerror = (err) => reject(err);
                        img.src = src;
                    });
            
                const { width, height } = await getImageDimensions(generatedImage);

                const response = await fetch(generatedImage);
                const blob = await response.blob();
                const previousLookbookFile = new File([blob], "previous_lookbook.png", { type: blob.type });

                const editingPrompt = `${activeSystemPrompt}\n\n## EDITING MODE: AESTHETIC TRANSFORMATION ##\nYou are now in editing mode. Your task is to apply a NEW creative direction to a previously generated image.\n\n**HIERARCHY OF EDITS (MOST IMPORTANT FIRST):**\n\n1.  **AESTHETIC INSPIRATION PHOTO:** THIS IS YOUR #1 PRIORITY. If an 'AESTHETIC INSPIRATION PHOTO' is provided, you MUST completely transform the 'IMAGE TO EDIT' to match its style, mood, color palette, lighting, and even the general setting. This overrides the original image's aesthetic entirely. (This rule is ignored if you are in Product Shot mode, where the setting is guided by the Creative Brief).\n\n2.  **CREATIVE BRIEF (Text):** This text dictates the scene and action. It works with the 'AESTHETIC INSPIRATION PHOTO' to define the new scene.\n\n3.  **PRESERVATION OF IDENTITY:** While transforming the aesthetic, you MUST preserve the face, body, and identity of the model from the 'IMAGE TO EDIT'. DO NOT CHANGE THE PERSON. (This rule is ignored if you are in Product Shot mode).\n\n4.  **HERO ITEM INTEGRITY:** The 'HERO ITEM' must remain accurate, using the 'HERO ITEM REFERENCE' as a guide.\n\n5.  **ASPECT RATIO LOCK:** The output image MUST EXACTLY MATCH the aspect ratio of the 'IMAGE TO EDIT' (original dimensions were ${width}x${height}px).\n\n**IGNORE THE ORIGINAL AESTHETIC:**\nYou are not making a 'subtle improvement'. You are performing a complete aesthetic overhaul based on the new inputs. The original 'IMAGE TO EDIT' is just a canvas for the model's identity and the hero item.\n`;
    
                parts.push({ text: editingPrompt });

                parts.push({ text: '\n\n---\n\n**CREATIVE DIRECTION FOR REFINEMENT**' });
                parts.push({ text: '\n\n**INPUT: HERO ITEM REFERENCE**' });
                parts.push(await fileToGenerativePart(heroItem));

                if (inspirationPhoto) {
                    parts.push({ text: '\n\n**INPUT: AESTHETIC INSPIRATION PHOTO**' });
                    parts.push(await fileToGenerativePart(inspirationPhoto));
                }

                const defaultRefinePrompt = 'Make a subtle improvement to the overall aesthetic.';
                parts.push({ text: `\n\n**INPUT: CREATIVE BRIEF**\n"${stylePrompt || defaultRefinePrompt}"` });

                parts.push({ text: '\n\n---\n\n**IMAGE TO BE EDITED**' });
                parts.push({ text: '\n\n**INPUT: IMAGE TO EDIT**' });
                parts.push(await fileToGenerativePart(previousLookbookFile));

                parts.push({ text: '\n\n---\n\n**ACTION: Generate the refined image now based on the new creative direction and the image to be edited.**' });
                
            } else {
                parts.push({ text: activeSystemPrompt });
                parts.push({ text: '\n\n---\n\n**INPUT: HERO ITEM PHOTO**' });
                parts.push(await fileToGenerativePart(heroItem));
                if (inspirationPhoto) {
                    parts.push({ text: '\n\n**INPUT: AESTHETIC INSPIRATION PHOTO**' });
                    parts.push(await fileToGenerativePart(inspirationPhoto));
                }
                const defaultPrompt = isProductShot
                    ? 'A suitable product shot scene.'
                    : 'A suitable fashion lookbook scene.';

                parts.push({ text: `\n\n**INPUT: CREATIVE BRIEF**\n"${stylePrompt || defaultPrompt}"` });
                parts.push({ text: '\n\n---\n\n**ACTION: Generate the final image now based on all instructions and inputs provided.**' });
            }
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts },
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT],
                },
            });

            const imagePart = response.candidates?.[0]?.content.parts.find(part => part.inlineData);

            if (imagePart && imagePart.inlineData) {
                const base64Image = imagePart.inlineData.data;
                const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${base64Image}`;
                setGeneratedImage(imageUrl);
            } else {
                throw new Error("The Alchemist couldn't generate an image. Try refining your inputs.");
            }

        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "An unknown error occurred.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartOver = () => {
        setGeneratedImage(null);
        setError(null);
    };

    const handleDownload = (aspect: '1:1' | '9:16' | '16:9') => {
        if (!generatedImage) return;
        const image = new Image();
        image.crossOrigin = 'anonymous'; // Prevents canvas tainting with external images
        image.src = generatedImage;
    
        image.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
    
            const sourceWidth = image.naturalWidth;
            const sourceHeight = image.naturalHeight;
            const sourceAspect = sourceWidth / sourceHeight;
    
            let targetAspect;
            if (aspect === '16:9') targetAspect = 16 / 9;
            else if (aspect === '9:16') targetAspect = 9 / 16;
            else targetAspect = 1; // 1:1
    
            let sx = 0, sy = 0, sWidth = sourceWidth, sHeight = sourceHeight;
    
            if (sourceAspect > targetAspect) {
                // Source is wider than target, crop width (pillarbox)
                sWidth = sourceHeight * targetAspect;
                sx = (sourceWidth - sWidth) / 2;
            } else if (sourceAspect < targetAspect) {
                // Source is taller than target, crop height (letterbox)
                sHeight = sourceWidth / targetAspect;
                sy = (sourceHeight - sHeight) / 2; // Default to center
            }
    
            // For landscape crops of portraits, bias the crop upwards to capture the head.
            if (aspect === '16:9' && sourceAspect < targetAspect) {
                sy = (sourceHeight - sHeight) * 0.3; // Places crop in the top third.
            }
    
            canvas.width = sWidth;
            canvas.height = sHeight;
    
            ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
    
            const link = document.createElement('a');
            link.download = `lookbook-${aspect.replace(':', 'x')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        };
    
        image.onerror = () => {
            setError("Could not download image due to an error loading it.");
        };
    
        setDownloadMenuOpen(false);
    };

    const staticPresets = {
        'Vintage': 'A photograph with a vintage, film-like quality, featuring muted colors and soft focus. The scene has a nostalgic, retro feel.',
        'Modern': 'A clean, minimalist photograph with sharp lines, a neutral color palette, and a focus on modern architecture or simple backgrounds.',
        'Bohemian': 'A warm, free-spirited photograph with earthy tones, natural light, and outdoor elements like fields or forests. The mood is relaxed and artistic.',
        'Streetwear': 'A dynamic, urban photograph taken on city streets, featuring graffiti, neon lights, or gritty textures. The style is edgy and contemporary.',
    };

    const suggestedPresets: { [key: string]: { [key: string]: string } } = {
        'Hand': {
            'Close-up Hand Shot': 'A detailed close-up shot of a model\'s hand, elegantly displaying the accessory against a blurred, sophisticated background.',
            'Lifestyle Wrist Shot': 'A lifestyle photo of a model\'s wrist and hand, with the accessory as the focal point, in a natural, everyday setting like a cafe.',
        },
        'Neck/Face': {
            'Elegant Portrait': 'A close-up portrait of a female model, focusing on the neck and face to highlight the accessory with soft, flattering light.',
            'Candid Profile Shot': 'A candid-style profile shot of a model, showcasing the accessory from the side in a beautiful outdoor or indoor location.',
        },
        'Apparel': {
            'Full Body Look': 'A full-body fashion shot of a model wearing the item as part of a complete, stylish outfit on a city street.',
            'Lifestyle Context': 'A relaxed, candid-style photo of a model wearing the clothing item in a relatable, everyday environment like a park or coffee shop.',
        },
    };

    const getSuggestedPresets = () => {
        if (!itemCategory) return null;
        if (['Watch', 'Bracelet', 'Ring'].includes(itemCategory)) return suggestedPresets['Hand'];
        if (['Necklace', 'Earrings'].includes(itemCategory)) return suggestedPresets['Neck/Face'];
        if (['T-Shirt', 'Top', 'Jacket', 'Pants', 'Dress', 'Hat', 'Shoes', 'Handbag'].includes(itemCategory)) return suggestedPresets['Apparel'];
        return null;
    };
    
    const buttonText = generatedImage ? 'Refine Lookbook' : 'Create Lookbook';
    const loadingButtonText = generatedImage ? 'Refining...' : 'Creating...';
    const currentSuggestedPresets = getSuggestedPresets();

    return (
        <div className="app-container">
            <aside className={`controls-panel ${isLoading ? 'loading' : ''}`}>
                <header className="header">
                    <h1>The Alchemist's Studio</h1>
                    <p>Generate a stunning lookbook photograph from your clothing item.</p>
                </header>

                <ImageUploader
                    title="1. Hero Item"
                    description="(Required) The piece of clothing to feature."
                    selectedFile={heroItem}
                    onFileSelect={setHeroItem}
                    onFileRemove={() => setHeroItem(null)}
                />

                <ImageUploader
                    title="2. Visual Inspiration"
                    description="(Optional) An image for style, mood, and lighting."
                    selectedFile={inspirationPhoto}
                    onFileSelect={setInspirationPhoto}
                    onFileRemove={() => setInspirationPhoto(null)}
                />

                <div className="input-group">
                    <label htmlFor="style-prompt">3. Creative Brief</label>
                    <p style={{marginTop: '-4px', marginBottom: '12px'}}><span>(Optional) Refine the scene with text.</span></p>

                    {isIdentifying && <p className="identifying-text">Identifying item...</p>}
                    
                    {itemCategory && accessoryCategories.includes(itemCategory) && (
                        <div className="presets-container">
                            <p className="presets-title">Shot Type</p>
                            <div>
                                <button 
                                    className={`preset-btn ${shotType === 'model' ? 'active' : ''}`} 
                                    onClick={() => setShotType('model')}>
                                    On-Model
                                </button>
                                <button 
                                    className={`preset-btn ${shotType === 'product' ? 'active' : ''}`} 
                                    onClick={() => setShotType('product')}>
                                    Product Shot
                                </button>
                            </div>
                        </div>
                    )}

                    {currentSuggestedPresets && shotType === 'model' && (
                        <div className="presets-container">
                            <p className="presets-title">Suggested Prompts</p>
                            <div>
                                {Object.entries(currentSuggestedPresets).map(([name, prompt]) => (
                                    <button key={name} className="preset-btn" onClick={() => setStylePrompt(prompt)}>{name}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="presets-container">
                        <p className="presets-title">Style Presets</p>
                        <div>
                            {Object.entries(staticPresets).map(([name, prompt]) => (
                                <button key={name} className="preset-btn" onClick={() => setStylePrompt(prompt)}>{name}</button>
                            ))}
                        </div>
                    </div>

                    <textarea
                        id="style-prompt"
                        value={stylePrompt}
                        onChange={(e) => setStylePrompt(e.target.value)}
                        placeholder="e.g., 'A model on a neon-lit Tokyo street at night'"
                    />
                </div>

                <button
                    className="generate-btn"
                    onClick={handleGenerate}
                    disabled={!heroItem || isLoading}
                >
                    {isLoading ? (
                        <>
                            <div className="btn-spinner"></div>
                            <span>{loadingButtonText}</span>
                        </>
                    ) : (
                        <span>{buttonText}</span>
                    )}
                </button>
            </aside>
            <main className="output-panel">
                 {isLoading && (
                    <div className="progress-bar">
                        <div className="progress-bar-inner"></div>
                    </div>
                )}
                <div className={`output-wrapper ${isLoading ? 'is-loading' : ''}`}>
                    {generatedImage ? (
                         <>
                            <img src={generatedImage} alt="Generated lookbook" className="output-image" />
                            <div className="output-actions">
                                <button onClick={handleStartOver} className="start-over-btn" disabled={isLoading}>Start Over</button>
                                <div className="download-container">
                                    <button className="download-btn" onClick={() => !isLoading && setDownloadMenuOpen(!isDownloadMenuOpen)} disabled={isLoading}>
                                        Download
                                    </button>
                                    {isDownloadMenuOpen && (
                                        <div className="download-menu">
                                            <button onClick={() => handleDownload('1:1')}>Square (1:1)</button>
                                            <button onClick={() => handleDownload('9:16')}>Portrait (9:16)</button>
                                            <button onClick={() => handleDownload('16:9')}>Landscape (16:9)</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : error ? (
                        <div className="error-message">
                           <h2>Alchemy Failed</h2>
                           <p>{error}</p>
                       </div>
                   ) : (
                        <div className="placeholder">
                           <h2>Your Masterpiece Awaits</h2>
                           <p>Upload your assets and let the alchemy begin.</p>
                       </div>
                   )}
                </div>
            </main>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);