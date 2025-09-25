import React, { useState } from 'react';
import { View, Text, TextInput, Button, Switch, Alert } from 'react-native';
import { useStore } from '../store/useStore';

export default function Settings() {
  const { apiBase, provider, model, mature, customOllamaModel, tweakMode, set } = useStore();
  const [prov, setProv] = useState(provider);
  const [mdl, setMdl] = useState(model);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [matureLang, setMatureLang] = useState(mature);
  const [customModel, setCustomModel] = useState(customOllamaModel || '');
  const [tweak, setTweak] = useState<'off'|'suggest'|'auto'>(tweakMode);
  const [useRag, setUseRag] = useState(true);
  const [reviewProv, setReviewProv] = useState<'mock'|'openai'|'ollama'>(prov==='ollama'?'ollama':'openai');
  const [reviewModel, setReviewModel] = useState('gpt-5-mini');

  return (
    <View style={{flex:1, padding:12}}>
      <Text style={{fontSize:18, fontWeight:'700'}}>Settings</Text>
      <Text style={{marginTop:8}}>Provider: {prov}</Text>
      <View style={{flexDirection:'row', marginVertical:6}}>
        <Button title="Gemini" onPress={()=>setProv('gemini' as any)} />
        <View style={{width:8}} />
        <Button title="OpenAI" onPress={()=>setProv('openai' as any)} />
        <View style={{width:8}} />
        <Button title="Ollama (local)" onPress={()=>setProv('ollama' as any)} />
      </View>
      <Text>Model: {mdl}</Text>
      {prov==='gemini' && (
        <View style={{flexDirection:'row', marginVertical:6}}>
          <Button title="2.5 Flash" onPress={()=>setMdl('gemini-2.5-flash' as any)} />
          <View style={{width:8}} />
          <Button title="2.5 Flash-Lite" onPress={()=>setMdl('gemini-2.5-flash-lite' as any)} />
        </View>
            {prov==='openai' && (
        <View style={{flexDirection:'row', marginVertical:6, flexWrap:'wrap'}}>
          <Button title="gpt-5" onPress={()=>setMdl('gpt-5' as any)} />
          <View style={{width:8}} />
          <Button title="gpt-5-mini" onPress={()=>setMdl('gpt-5-mini' as any)} />
          <View style={{width:8}} />
          <Button title="gpt-5-nano" onPress={()=>setMdl('gpt-5-nano' as any)} />
        </View>
      )}
)}
      {prov==='ollama' && (
        <View style={{marginVertical:6}}>
          <View style={{flexDirection:'row', flexWrap:'wrap'}}>
            <Button title="Qwen2.5 7B" onPress={()=>setMdl('ollama-qwen2.5-7b-instruct' as any)} />
            <View style={{width:8}} />
            <Button title="Llama 3.1 8B" onPress={()=>setMdl('ollama-llama3.1-8b-instruct' as any)} />
            <View style={{width:8}} />
            <Button title="Hermes RP 8B" onPress={()=>setMdl('ollama-roleplay-hermes-3-llama-3.1-8b' as any)} />
          </View>
          <View style={{height:8}} />
          <Button title="Use deepseek-r1:1.5b" onPress={()=>{ setProv('ollama' as any); setCustomModel('deepseek-r1:1.5b'); }} />
          <Text style={{marginTop:8}}>Custom Ollama model (optional)</Text>
          <TextInput value={customModel} onChangeText={setCustomModel} placeholder="e.g., qwen2.5:7b-instruct-q4_0"
            style={{borderWidth:1, borderColor:'#ccc', padding:8, borderRadius:6, marginTop:6}} />
          <View style={{height:8}} />
          <Button title="Test Ollama" onPress={async ()=>{
            try {
              const r = await fetch(`${apiBase}/api/providers/ollama/health`).then(x=>x.json());
              if (r.ok) {
                Alert.alert('Ollama OK', `Base: ${r.base}\nVersion: ${r.version || 'unknown'}\nModels: ${(r.models?.slice(0,6) || []).join(', ') || 'n/a'}`);
              } else {
                Alert.alert('Ollama not reachable', `Tried ${r.base}`);
              }
            } catch (e) {
              Alert.alert('Ollama check failed', String(e));
            }
          }} />
        </View>
      )}
      <View style={{flexDirection:'row', alignItems:'center', marginTop:12}}>
        <Switch value={autoSwitch} onValueChange={setAutoSwitch} />
        <Text style={{marginLeft:8}}>Auto-switch to other free model on limit</Text>
      </View>
      <View style={{flexDirection:'row', alignItems:'center', marginTop:12}}>
        <Switch value={matureLang} onValueChange={setMatureLang} />
        <Text style={{marginLeft:8}}>Mature language (in-character)</Text>
      </View>

      <View style={{marginTop:12}}>
        <Text style={{fontWeight:'600'}}>RAG Reviewer</Text>
        <View style={{flexDirection:'row', alignItems:'center', marginTop:6}}>
          <Switch value={useRag} onValueChange={setUseRag} />
          <Text style={{marginLeft:8}}>Use RAG</Text>
        </View>
        <View style={{flexDirection:'row', marginTop:6}}>
          <Button title={`Reviewer: ${reviewProv}`} onPress={()=> setReviewProv(reviewProv==='openai'?'ollama':reviewProv==='ollama'?'mock':'openai')} />
          <View style={{width:8}} />
          <TextInput value={reviewModel} onChangeText={setReviewModel} placeholder="reviewer model (e.g., gpt-5-mini)" style={{flex:1, borderWidth:1, borderColor:'#ccc', padding:8, borderRadius:6}} />
        </View>
      </View>
      <View style={{marginTop:12}}>
        <Text style={{fontWeight:'600'}}>Prompt Tweaker</Text>
        <View style={{flexDirection:'row', marginTop:6}}>
          <Button title={`Off${tweak==='off'?' ✓':''}`} onPress={()=>setTweak('off')} />
          <View style={{width:8}} />
          <Button title={`Suggest${tweak==='suggest'?' ✓':''}`} onPress={()=>setTweak('suggest')} />
          <View style={{width:8}} />
          <Button title={`Auto-rewrite${tweak==='auto'?' ✓':''}`} onPress={()=>setTweak('auto')} />
        </View>
      </View>

      <View style={{marginTop:12}}>
        <Text style={{fontWeight:'600'}}>RAG Reviewer</Text>
        <View style={{flexDirection:'row', alignItems:'center', marginTop:6}}>
          <Switch value={useRag} onValueChange={setUseRag} />
          <Text style={{marginLeft:8}}>Use RAG</Text>
        </View>
        <View style={{flexDirection:'row', marginTop:6}}>
          <Button title={`Reviewer: ${reviewProv}`} onPress={()=> setReviewProv(reviewProv==='openai'?'ollama':reviewProv==='ollama'?'mock':'openai')} />
          <View style={{width:8}} />
          <TextInput value={reviewModel} onChangeText={setReviewModel} placeholder="reviewer model (e.g., gpt-5-mini)" style={{flex:1, borderWidth:1, borderColor:'#ccc', padding:8, borderRadius:6}} />
        </View>
      </View>
      <View style={{marginTop:12}}>
        <Button title="Save" onPress={()=> set({ provider: prov as any, model: mdl as any, mature: matureLang, customOllamaModel: customModel, tweakMode: tweak }) } />
      </View>
    </View>
  );
}
