(function(){
var m=document.querySelector('.sheet'),o=document.getElementById('openMenu');
function set(v){m.hidden=!v;o.setAttribute('aria-expanded',v)}
o.addEventListener('click',function(){set(true)});
document.querySelectorAll('[data-close]').forEach(function(e){e.addEventListener('click',function(){set(false)})});
document.querySelectorAll('.fq button').forEach(function(b){b.addEventListener('click',function(){
 var item=b.closest('.fq'),open=item.classList.contains('open');
 document.querySelectorAll('.fq').forEach(function(f){f.classList.remove('open');f.querySelector('button').setAttribute('aria-expanded','false');f.querySelector('[role=region]').setAttribute('aria-hidden','true')});
 if(!open){item.classList.add('open');b.setAttribute('aria-expanded','true');item.querySelector('[role=region]').setAttribute('aria-hidden','false')}})});
// The demo form posts to the Stitch API (POST /api/enquiries); an admin reads the answers in the app
var API=import.meta.env.VITE_API_URL||'/api';
document.getElementById('lead').addEventListener('submit',function(e){
 e.preventDefault();
 var form=this,btn=document.getElementById('lead-btn'),err=document.getElementById('lead-err');
 err.hidden=true;btn.disabled=true;
 fetch(API+'/enquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))})
 .then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(d.error||'Something went wrong. Please try again.');})})
 .then(function(){form.hidden=true;document.getElementById('sent').hidden=false})
 .catch(function(x){err.textContent=x.message;err.hidden=false;btn.disabled=false});
});
})();
