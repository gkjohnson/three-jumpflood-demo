
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let camera, scene, renderer, controls;
let effectQuad, jfaQuad;
let infoContainer;
let targets, seedMaterial;
let clearColor = new THREE.Color();
const MAX_VALUE = 2**14;

let frameTime = 0;
let frameSamples = 0;
let lastFrameStart = - 1;

const params = {
    mode: 1,
    thickness: 10,
    color: '#e91e63',
};

async function init() {

    infoContainer = document.getElementById( 'info' );

    camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.25, 20 );
    camera.position.set( 3, 2, 3 );

    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setClearColor( 0x171717, 1 );
    document.body.appendChild( renderer.domElement );

    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1;

    seedMaterial = new SeedMaterial();
    seedMaterial.side = THREE.DoubleSide;
    
    // initialize the JFA ping pong targets
    // note that integer targets require non-interpolated filters to function
    targets = [
        new THREE.WebGLRenderTarget( 1, 1, {
            format: THREE.RedIntegerFormat,
            type: THREE.IntType,
            internalFormat: 'R32I',
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        } ),
        new THREE.WebGLRenderTarget( 1, 1, {
            format: THREE.RedIntegerFormat,
            type: THREE.IntType,
            internalFormat: 'R32I',
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        } ),
    ];

    // create a quad for the final screen effect
    effectQuad = new FullScreenQuad( new EffectMaterial() );

    jfaQuad = new FullScreenQuad( new JFAMaterial() );

    // load the model & env map
    const modelPromise = new GLTFLoader()
        .setMeshoptDecoder( MeshoptDecoder )
        .loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/vilhelm-13/vilhelm_13.glb' )
        .then( gltf => {

            gltf.scene.scale.setScalar( 0.025 );
            gltf.scene.rotation.y += Math.PI;

            new THREE.Box3()
                .setFromObject( gltf.scene )
                .getCenter( gltf.scene.position )
                .multiplyScalar( - 1 );

            gltf.scene.updateMatrixWorld();

            gltf.scene.traverse( c => {

                if ( c.material ) {

                    c.material.transparent = false;
                    c.material.depthWrite = true;

                }

            } );
            scene.add( gltf.scene );

        } );

    const envPromise = await new HDRLoader()
        .loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/leadenhall_market_1k.hdr' )
        .then( tex => {

            tex.mapping = THREE.EquirectangularReflectionMapping;
            scene.environment = tex;

        } );

    await Promise.all( [ modelPromise, envPromise ] );

    renderer.setAnimationLoop( animate );

    const gui = new GUI();
    gui.add( params, 'mode', { 'SDF': 0, 'Outline': 1, 'Glow': 2 } );
    gui.add( params, 'thickness', 0, 50 );
    gui.addColor( params, 'color' );

    window.addEventListener( 'resize', onWindowResize );
    onWindowResize();

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio;
    renderer.setSize( w, h );
    renderer.setPixelRatio( dpr );

    renderer.domElement.style.imageRendering = 'pixelated'

    targets[ 0 ].setSize( dpr * w, dpr * h );
    targets[ 1 ].setSize( dpr * w, dpr * h );

}

function animate() {

    // frame time tracking
    let frameDelta;
    if ( lastFrameStart === - 1 ) {

        lastFrameStart = window.performance.now();

    } else {

        frameDelta = window.performance.now() - lastFrameStart;
        frameTime += ( frameDelta - frameTime ) / ( frameSamples + 1 );
        if ( frameSamples < 60 ) {
        
            frameSamples ++

        }

        lastFrameStart = window.performance.now();

    }

    controls.update();
    renderer.info.autoReset = false;

    // render the main scene
    renderer.setClearColor( 0x171717, 1 );
    renderer.render( scene, camera );

    //

    // initialize the JFA seed - negative values are "inside" the mesh to be rendered
    clearColor.setScalar( MAX_VALUE );
    renderer.setClearColor( clearColor )
    seedMaterial.value.setScalar( - MAX_VALUE );

    // render the scene with the seed values
    scene.overrideMaterial = seedMaterial;
    renderer.setRenderTarget( targets[ 0 ] );
    renderer.render( scene, camera );
    renderer.setRenderTarget( null );
    scene.overrideMaterial = null;

    let step = Math.min( Math.max( targets[ 0 ].width, targets[ 0 ].height ), params.thickness + 1 );
    while( true ) {

        jfaQuad.material.step = step;
        jfaQuad.material.source = targets[ 0 ].texture;

        renderer.setRenderTarget( targets[ 1 ] );
        jfaQuad.render( renderer );
        renderer.setRenderTarget( null );

        targets.reverse();

        if ( step <= 1 ) {

            break;

        }

        step = Math.ceil( step * 0.5 );

    }


    // render the final effect
    renderer.autoClear = false;
    effectQuad.material.map = targets[ 0 ].texture;
    effectQuad.material.thickness = params.thickness;
    effectQuad.material.mode = params.mode;
    effectQuad.material.color.set( params.color );
    effectQuad.render( renderer );
    renderer.autoClear = true;

    // update stats
    infoContainer.innerText = 
        `Draw Calls: ${ renderer.info.render.calls }\n` +
        `Frame Time: ${ frameTime.toFixed( 2 ) }ms\n` +
        `FPS       : ${ ( 1000 / frameTime ).toFixed( 2 ) }`;
    renderer.info.reset();

}

class SeedMaterial extends THREE.ShaderMaterial {

    get value() {

        return this.uniforms.value.value;

    }

    constructor() {

        super( {

            glslVersion: THREE.GLSL3,

            uniforms: {
                value: { value: new THREE.Vector4() },
            },

            vertexShader: /* glsl */`

                void main() {

                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }

            `,

            fragmentShader: /* glsl */`

                layout( location = 0 ) out ivec4 out_color;
                uniform ivec4 value;
                void main() {

                    out_color = value;

                }

            `,

        } );

    }

}

class EffectMaterial extends THREE.ShaderMaterial {

    get map() {

        return this.uniforms.map.value;

    }

    set map( v ) {

        this.uniforms.map.value = v;

    }

    get thickness() {

        return this.uniforms.thickness.value;

    }

    set thickness( v ) {

        this.uniforms.thickness.value = v;

    }

    get mode() {

        return this.uniforms.mode.value;

    }

    set mode( v ) {

        this.uniforms.mode.value = v;

    }

    get color() {

        return this.uniforms.color.value;

    }

    constructor() {

        super( {

            transparent: true,
            uniforms: {
                map: { value: null },
                color: { value: new THREE.Color() },
                thickness: { value: 5 },
                mode: { value: 1 },
            },

            vertexShader: /* glsl */`

                varying vec2 vUv;
                void main() {

                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }

            `,

            fragmentShader: /* glsl */`

                varying vec2 vUv;
                uniform isampler2D map;
                uniform float thickness;
                uniform int mode;
                uniform vec3 color;

                float fwidth2( float v ) {

                    float vdy = dFdy( v );
                    float vdx = dFdx( v );
                    return length( vec2( vdy, vdx ) );

                }

                void main() {

                    if ( mode == 0 ) {

                        // sdf
                        float v = float( texture( map, vUv ).r );
                        gl_FragColor = vec4( abs( v ) ) / thickness;
                        gl_FragColor.a = 1.0;

                    } else if ( mode == 1 ) {

                        // outline
                        float val = 0.0;
                        for ( int x = - 1; x <= 1; x ++ ) {

                            for ( int y = - 1; y <= 1; y ++ ) {

                                ivec2 coord = ivec2( gl_FragCoord.xy ) + ivec2( x, y );
                                coord = clamp( coord, ivec2( 0 ), textureSize( map, 0 ) - ivec2( 1.0 ) );
                                val += float( texelFetch( map, coord, 0 ).r + 1 ) / 9.0;

                            }

                        }

                        val = smoothstep( thickness + 1.0, thickness, val ) * clamp( val, 0.0, 1.0 );

                        gl_FragColor.rgb = vec3( color );
                        gl_FragColor.a = val;

                    } else if ( mode == 2 ) {

                        // glow
                        float val = 0.0;
                        for ( int x = - 1; x <= 1; x ++ ) {

                            for ( int y = - 1; y <= 1; y ++ ) {

                                ivec2 coord = ivec2( gl_FragCoord.xy ) + ivec2( x, y );
                                coord = clamp( coord, ivec2( 0 ), textureSize( map, 0 ) - ivec2( 1.0 ) );
                                val += float( texelFetch( map, coord, 0 ).r + 1 ) / 9.0;

                            }

                        }

                        gl_FragColor.rgb = color;
                        gl_FragColor.a = ( 1.0 - val / thickness ) * clamp( val, 0.0, 1.0 );

                    }

                    #include <colorspace_fragment>

                }

            `,

        } );
        
    }

}

class JFAMaterial extends THREE.ShaderMaterial {

    get source() {

        return this.uniforms.source.value;

    }

    set source( v ) { 

        this.uniforms.source.value = v;

    }

    get step() {

        return this.uniforms.step.value;

    }

    set step( v ) {

        this.uniforms.step.value = v;

    }

    get firstStep() {

        return Boolean( this.uniforms.firstStep.value );

    }

    set firstStep( v ) {

        this.uniforms.firstStep.value = Number( v );

    }

    constructor() {

        super( {

            glslVersion: THREE.GLSL3,

            uniforms: {
                source: { value: null },
                step: { value: 0 },
                firstStep: { value: 0 },
            },

            vertexShader: /* glsl */`

                void main() {

                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }

            `,

            fragmentShader: /* glsl */`

                layout( location = 0 ) out ivec4 out_color;

                uniform isampler2D source;
                uniform int step;
                uniform int firstStep;
                void main() {

                    int result = texelFetch( source, ivec2( gl_FragCoord.xy ), 0 ).r;
                    for ( int x = - 1; x <= 1; x ++ ) {

                        for ( int y = - 1; y <= 1; y ++ ) {

                            // skip the center pixel
                            if ( x == 0 && y == 0 ) {

                                continue;

                            }

                            // skip pixels that are outside the target bounds
                            ivec2 coord = ivec2( gl_FragCoord.xy ) + ivec2( x, y ) * step;
                            ivec2 res = textureSize( source, 0 );
                            if (
                                coord.x >= res.x || coord.x < 0 ||
                                coord.y >= res.y || coord.y < 0
                            ) {

                                continue;

                            }

                            int t = texelFetch( source, coord, 0 ).r;
                            if ( sign( result ) != sign( t ) ) {

                                // if the sign is different then we've found a new distance
                                result = sign( result ) * min( abs( result ), step );

                            } else {

                                // if the sign is the same then we can extend off of that distance
                                result = sign( result ) * min( abs( result ), abs( t ) + step );

                            }

                        }

                    }

                    out_color = ivec4( result );

                }

            `,

        } );

    }

}

init();
